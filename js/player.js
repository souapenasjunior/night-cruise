// Player vehicle: arcade physics on the ribbon network, walls, lights and signals.
import * as THREE from 'three';
import { clamp, lerp, damp } from './util.js';
import { PARAPET_W, BARRIER_HW } from './network.js';

const G = 9.81;

export class Player {
  constructor(net, model, spec, scene) {
    this.net = net;
    this.model = model;
    this.spec = spec;
    this.stats = spec.stats;
    this.scene = scene;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.vx = 0; this.vz = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.rib = net.ring;
    this.s = 0; this.off = 0; this.iHint = 0;
    this.y = 0;
    this.vy = 0;
    this.pitch = 0; this.bodyPitch = 0; this.bodyRoll = 0;
    this.speed = 0; this.vf = 0; this.vl = 0;
    this.slip = 0;
    this.lights = { head: true, left: false, right: false, hazard: false };
    this.braking = false; this.reversing = false;
    this.blinkT = 0; this.blinkOn = false;
    this.signalArmed = 0; this.signalTimer = 0;
    this.halfW = model.W > 1.5 ? model.W / 2 : 0.95;
    // open-wheel cars: the track is wider than the body (wheel widths may differ per axle)
    if (spec.wheels.x) {
      const ww = spec.wheels.w || Math.max(...(spec.wheels.list || []).map(w => w.w || 0.4), 0.4);
      this.halfW = Math.max(this.halfW, spec.wheels.x + ww / 2 - 0.05);
    }
    this.halfL = model.L / 2;
    this.impacts = [];
    this._res = [];
    this._P = {};
    this.lastGood = null;
    // headlight
    this.spot = new THREE.SpotLight(0xfff1d6, 0, 110, 0.52, 0.55, 1.2);
    this.spot.position.set(0, 0.9, this.halfL - 0.2);
    this.spot.target.position.set(0, -0.6, this.halfL + 30);
    model.group.add(this.spot, this.spot.target);
    this.fill = new THREE.PointLight(0xffe9c8, 0, 14, 2);
    this.fill.position.set(0, 1.0, this.halfL + 3);
    model.group.add(this.fill);
    scene.add(model.group);
  }

  // release GPU resources owned by this car (shadow map, geometry, per-car materials)
  dispose() {
    if (this.spot.shadow.map) { this.spot.shadow.map.dispose(); this.spot.shadow.map = null; }
    this.spot.dispose();
    if (this.model.group.parent) this.model.group.parent.remove(this.model.group);
    this.model.dispose();
  }

  setShadows(level) {
    this.spot.castShadow = level !== 'off';
    const sz = level === 'high' ? 1024 : 512;
    this.spot.shadow.mapSize.set(sz, sz);
    this.spot.shadow.camera.near = 1;
    this.spot.shadow.camera.far = 90;
    this.spot.shadow.bias = -0.0005;
    if (this.spot.shadow.map) { this.spot.shadow.map.dispose(); this.spot.shadow.map = null; }
  }

  place(rib, s, off, dir) {
    const P = rib.pointAt(s, off, this._P);
    this.rib = rib;
    this.s = s; this.off = off; this.iHint = P.i;
    this.pos.set(P.x, P.y, P.z);
    this.y = P.y;
    this.yaw = Math.atan2(P.tx * dir, P.tz * dir);
    this.vx = this.vz = 0;
    this.yawRate = 0;
    this.lastGood = { rib, s, off, dir };
    this._sync(0);
  }

  // Put the car back on the nearest lane (never the shoulder), facing the legal direction. In a parking
  // bay that is the PA's access road.
  reset() {
    let r = this.rib;
    let P = r.projectLocal(this.pos.x, this.pos.z, this.iHint, 20, {});
    if (r.kind === 'lot' && this.net.pa) { r = this.net.pa.road; P = r.projectGlobal(this.pos.x, this.pos.z, {}); }
    let dir = 1, lanes;
    if (r.lanes[-1]) { dir = P.off < 0 ? 1 : -1; }
    lanes = r.lanes[dir];
    let best = lanes[0];
    for (const l of lanes) if (Math.abs(l - P.off) < Math.abs(best - P.off)) best = l;
    this.place(r, P.s, best, dir);
  }

  update(dt, inp, opts) {
    const st = this.stats;
    const vmax = st.top / 3.6;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx; // car right
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz;
    const speed = Math.hypot(this.vx, this.vz);

    // steering input smoothing
    const target = inp.steer;
    if (inp.analogSteer) this.steer = damp(this.steer, target, 18, dt);
    else {
      const rate = Math.abs(target) > Math.abs(this.steer) && Math.sign(target) === Math.sign(this.steer || target) ? 5.5 : 10;
      this.steer = damp(this.steer, target, rate, dt);
    }

    // longitudinal
    let a = 0;
    this.braking = false;
    this.reversing = false;
    const thr = inp.throttle, brk = inp.brake;
    if (thr > 0.02) {
      if (vf < -0.5) { a += 14 * thr; this.braking = true; }
      else {
        const x = clamp(vf / vmax, 0, 1.2);
        a += st.accel * thr * Math.max(0, 1 - Math.pow(x, 2.3)) * (1 + 0.25 * (1 - x));
      }
    }
    if (brk > 0.02) {
      if (vf > 0.8) { a -= 15.5 * brk * (0.8 + st.grip * 0.2); this.braking = true; }
      else if (thr < 0.1) { a -= 5.5 * brk; this.reversing = vf < -0.2 || brk > 0.5; if (vf < -9) a = Math.max(a, 0); }
    }
    // drag + rolling resistance
    a -= Math.sign(vf) * (0.35 + 0.00042 * vf * vf);
    if (Math.abs(vf) < 0.3 && thr < 0.02 && brk < 0.02) { vf *= Math.exp(-dt * 6); }
    // slope
    a -= G * clamp(this.pitch, -0.15, 0.15) * 0.8;
    vf += a * dt;

    // lateral / yaw
    const grip = st.grip;
    const absV = Math.abs(vf);
    const geoMax = absV * Math.tan(lerp(0.62, 0.22, clamp(absV / 30, 0, 1))) / 2.7;
    const latMax = (13.5 * grip) / Math.max(absV, 1);
    let yawTarget = -this.steer * Math.min(geoMax, latMax) * Math.sign(vf || 1);
    const slipAngle = Math.atan2(vl, Math.max(absV, 1));
    const drifting = Math.abs(slipAngle) > 0.12 && absV > 12;
    let yawK = 9;
    let latG = 10 * grip;
    if (drifting) {
      latG = (2.6 + (1 - Math.min(1, thr)) * 2.5) / st.drift;
      yawTarget *= 1.15;
      yawK = 6;
    }
    // natural rotation from lateral slip (lets the rear come around, then settle)
    yawTarget += drifting ? -slipAngle * 0.35 * (absV / 30) : 0;
    this.yawRate = damp(this.yawRate, yawTarget, yawK, dt);
    const newVl = vl * Math.exp(-latG * dt);
    if (vf > 0) vf += (Math.abs(vl) - Math.abs(newVl)) * 0.55;
    vl = newVl;
    this.yaw += this.yawRate * dt;
    const nfx = Math.sin(this.yaw), nfz = Math.cos(this.yaw);
    const nrx = -nfz, nrz = nfx;
    this.vx = nfx * vf + nrx * vl;
    this.vz = nfz * vf + nrz * vl;
    this.vf = vf; this.vl = vl;
    this.slip = clamp(Math.abs(vl) / 7 + (brk > 0.8 && absV > 20 ? 0.15 : 0) + (thr > 0.9 && absV < 8 && st.accel > 8 ? 0.4 : 0), 0, 1);

    // integrate
    const px = this.pos.x, pz = this.pos.z;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    this._surface(dt, px, pz, opts);

    // body motion (visual)
    const longA = a;
    const latA = vf * this.yawRate;
    this.bodyPitch = damp(this.bodyPitch, clamp(-longA * 0.006, -0.05, 0.05), 6, dt);
    this.bodyRoll = damp(this.bodyRoll, clamp(latA * 0.0045, -0.07, 0.07), 6, dt);
    this.speed = Math.hypot(this.vx, this.vz);
    this._signals(dt, inp);
    this._sync(dt);
  }

  _surface(dt, px, pz, opts) {
    const net = this.net;
    const res = net.surfacesAt(this.pos.x, this.pos.z, this.y, 2.6, 0, this._res);
    let cur = null, alt = null;
    for (const q of res) {
      if (q.r === this.rib) cur = q;
      else if (!alt || Math.abs(q.off) / q.r.hw < Math.abs(alt.off) / alt.r.hw) alt = q;
    }
    // switch ribbon if we are deeper inside another one
    if (alt && (!cur || Math.abs(cur.off) > cur.r.hw - 0.5 && Math.abs(alt.off) < alt.r.hw - 0.5)) cur = alt;
    if (!cur) {
      // off every surface: collide with the current ribbon edge
      const P = this.rib.projectLocal(this.pos.x, this.pos.z, this.iHint, 10, {});
      cur = { r: this.rib, ...P };
    } else cur = { ...cur }; // (surfacesAt hands out shared objects)
    const r = cur.r;
    this.rib = r;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let hit = 0;
    // walls: the parapets of every deck at this level. They stand where network.js buildWalls put them
    // (the same intervals the world draws). The car is a box (corners slightly rounded): each of its
    // corner, side and bumper points is placed on the deck at its own spot, so a curving wall is met
    // where it really is, and a point inside a wall is moved out the shorter way: back across the deck,
    // or, at a wall's sloped end (a gore nose), back along it. Nothing else stops the car at an edge:
    // where no parapet is drawn, the pavement goes on.
    const near = this.net.surfacesAt(this.pos.x, this.pos.z, this.y, 1.0, 2.6, []).map(q => ({ ...q }));
    const crx = -fz, crz = fx, L = this.halfL, W = this.halfW, P = this._wp || (this._wp = {});
    const body = this._body || (this._body = [[L - 0.25, W * 0.95], [L - 0.25, -W * 0.95], [-(L - 0.25), W * 0.95], [-(L - 0.25), -W * 0.95], [0, W], [0, -W], [L - 0.05, 0], [-(L - 0.05), 0]]);
    for (const q of near) {
      // (only from the deck's own side: a car on a neighbouring deck is behind this wall, not in it)
      if (Math.abs(q.off) > q.r.hw + 0.3) continue;
      const face = q.r.hw - PARAPET_W;
      for (let pass = 0; pass < 2; pass++) {
        let best = null;
        for (const [u, v] of body) {
          q.r.projectLocal(this.pos.x + fx * u + crx * v, this.pos.z + fz * u + crz * v, q.i, 3, P);
          const sg = Math.sign(P.off) || 1, pen = Math.abs(P.off) - face;
          if (pen <= 0 || pen > PARAPET_W + 0.6) continue;
          const span = q.r.wallSpan(sg, P.s);
          if (!span) continue;
          // the shorter way out: across, or off a sloped end
          let d = pen, ax = -P.tz * -sg, az = P.tx * -sg; // (unit vector out of the wall)
          const w = span.w;
          if (w.e0 === 'chamfer' && span.s - w.s0 < d) { d = span.s - w.s0 + 0.01; ax = -P.tx; az = -P.tz; }
          if (w.e1 === 'chamfer' && w.s1 - span.s < d) { d = w.s1 - span.s + 0.01; ax = P.tx; az = P.tz; }
          if (!best || d > best.d) best = { d, ax, az };
        }
        if (!best) break;
        this.pos.x += best.ax * best.d; this.pos.z += best.az * best.d;
        this._pushWall(best.d, -best.ax, -best.az, 1);
        hit = 1;
      }
    }
    // parking bays: their end walls (0.4 m thick, from the back wall to where the next deck begins)
    for (const q of near) {
      if (q.r.kind !== 'lot') continue;
      const ext = this.halfL * Math.abs(fx * q.tx + fz * q.tz) + this.halfW * Math.abs(-fz * q.tx + fx * q.tz);
      for (const [lim, sg, k] of [[PARAPET_W + ext, -1, 0], [q.r.len - PARAPET_W - ext, 1, 1]]) {
        if (q.off * q.r.outer < q.r.endIn[k] * q.r.outer) continue;
        const d = lim - q.s;
        if (d * sg >= 0) continue;
        this.pos.x += q.tx * d; this.pos.z += q.tz * d;
        this._pushWall(-d, q.tx, q.tz, sg);
        hit = 1;
      }
    }
    if (hit) {
      const P = r.projectLocal(this.pos.x, this.pos.z, cur.i, 4, {});
      Object.assign(cur, P);
    }
    this.s = cur.s;
    this.iHint = cur.i;
    let off = cur.off;
    const tx = r.tx[cur.i], tz = r.tz[cur.i];
    const rx = -tz, rz = tx;
    // an edge with no parapet and no pavement beyond (never built that way): hold the car on the deck
    if (Math.abs(off) > r.hw + 0.6 && !near.some(q => q.r !== r)) {
      const sg = Math.sign(off);
      hit = sg; this._pushWall(off - sg * (r.hw + 0.6), rx, rz, sg); off = sg * (r.hw + 0.6);
    }
    // ribbon ends
    if (!r.closed && (cur.t < 0 && cur.i === 0 || cur.t > 1 && cur.i >= r.n - 2)) {
      const endT = cur.i === 0 ? -1 : 1;
      const surf = this.net.surfacesAt(this.pos.x, this.pos.z, this.y, 2.6, 0, []).filter(q => q.r !== r);
      if (!surf.length) {
        const P = r.pointAt(cur.i === 0 ? 0.2 : r.len - 0.2, off, {});
        this.pos.x = P.x; this.pos.z = P.z;
        const vt = this.vx * tx + this.vz * tz;
        if (vt * endT > 0) { this.vx -= tx * vt * 1.3; this.vz -= tz * vt * 1.3; this._impact(Math.abs(vt)); }
      }
    }
    // median barrier (it ends exactly at the U-turn gaps, where it is drawn to end)
    const caM = Math.abs(fx * tx + fz * tz), saM = Math.sqrt(Math.max(0, 1 - caM * caM));
    const extM = (this.halfL - 0.3) * caM;
    if (r.median && ![0, extM, -extM].every(e => r.inMedianGap(r.wrapS(this.s + e)))) {
      const lim = BARRIER_HW + 0.01 + this.halfW * 0.92 * caM + (this.halfL - 0.3) * saM;
      if (Math.abs(off) < lim) {
        const prevSide = Math.sign(this.off || off) || 1;
        this._pushWall(off - prevSide * lim, rx, rz, -prevSide);
        off = prevSide * lim;
        hit = -prevSide;
      }
    }
    if (hit) {
      const P = r.pointAt(this.s, off, this._P);
      this.pos.x = P.x; this.pos.z = P.z;
    }
    this.off = off;
    // height & pitch
    const yT = cur.y !== undefined ? cur.y : r.pointAt(this.s, 0, this._P).y;
    this.y = Math.abs(yT - this.y) > 3 ? yT : damp(this.y, yT, 25, dt);
    this.pos.y = this.y;
    const along = Math.sin(this.yaw) * tx + Math.cos(this.yaw) * tz;
    this.pitch = Math.atan(r.sl[cur.i] * along);
    this.lastGood = { rib: r, s: this.s, off, dir: along >= 0 ? 1 : -1 };
    void opts; void px; void pz;
  }

  _pushWall(pen, rx, rz, sg) {
    // velocity into the wall along the ribbon's lateral axis
    const vn = (this.vx * rx + this.vz * rz) * sg;
    if (vn > 0) {
      const e = 0.25;
      this.vx -= rx * sg * vn * (1 + e);
      this.vz -= rz * sg * vn * (1 + e);
      // scrape friction
      const f = clamp(1 - vn * 0.035, 0.6, 0.995);
      this.vx *= f; this.vz *= f;
      // align yaw with the wall a little
      this.yawRate *= 0.6;
      this._impact(vn);
    } else {
      this.scrape = Math.min(1, (this.scrape || 0) + 0.2);
    }
    void pen;
  }

  _impact(v) {
    if (v > 1.5) this.impacts.push(clamp(v / 18, 0, 1));
  }

  applyImpulse(ix, iz, strength) {
    this.vx += ix; this.vz += iz;
    if (strength > 0.05) this.impacts.push(strength);
  }

  _signals(dt, inp) {
    const L = this.lights;
    if (L.left || L.right || L.hazard) {
      this.blinkT += dt;
      this.blinkOn = (this.blinkT % 0.8) < 0.42;
    } else { this.blinkT = 0; this.blinkOn = false; }
    // auto-cancel after a lane change / turn
    if ((L.left || L.right) && !L.hazard) {
      this.signalTimer += dt;
      const dir = L.left ? -1 : 1;
      if (this.steer * dir > 0.2) this.signalArmed = 1;
      if (this.signalArmed && Math.abs(this.steer) < 0.05) {
        this.signalArmed += dt;
        if (this.signalArmed > 1.4) { L.left = L.right = false; this.signalArmed = 0; }
      }
      if (this.signalTimer > 14) { L.left = L.right = false; }
    } else { this.signalTimer = 0; this.signalArmed = 0; }
    void inp;
  }
  toggleSignal(side) {
    const L = this.lights;
    L.hazard = false;
    if (side < 0) { L.left = !L.left; L.right = false; } else { L.right = !L.right; L.left = false; }
    this.signalTimer = 0; this.signalArmed = 0;
  }
  toggleHazard() { const L = this.lights; L.hazard = !L.hazard; if (L.hazard) { L.left = L.right = false; } }

  _sync(dt) {
    const g = this.model.group;
    g.position.copy(this.pos);
    g.rotation.set(0, this.yaw, 0, 'YXZ');
    g.rotation.x = -this.pitch;
    this.model.body.rotation.set(this.bodyPitch, 0, this.bodyRoll);
    const steerVis = -this.steer * lerp(0.5, 0.18, clamp(this.speed / 40, 0, 1));
    this.model.updateWheels(dt, this.vf, steerVis);
    const L = this.lights, on = this.blinkOn;
    this.model.setLights({
      head: L.head, brake: this.braking, reverse: this.reversing,
      left: on && (L.left || L.hazard), right: on && (L.right || L.hazard),
    });
    this.spot.intensity = L.head ? 190 : 0;
    this.fill.intensity = L.head ? 3 : 0;
  }

  // world-space positions of the head/tail lamps (for glow sprites)
  lampWorld(out) {
    const g = this.model.group;
    g.updateMatrixWorld();
    out.head = this.model.headLocal.map(v => v.clone().applyMatrix4(g.matrixWorld));
    out.tail = this.model.tailLocal.map(v => v.clone().applyMatrix4(g.matrixWorld));
    return out;
  }
}
