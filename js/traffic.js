// Traffic AI: lane following, IDM spacing, lane changes, exits/merges, encounters, collisions, light glows.
import * as THREE from 'three';
import { clamp, lerp, damp, wrap, wrapDelta, pick } from './util.js';
import { TRAFFIC_TYPES, buildTrafficGeometry, CarModel, twoTone } from './cars.js';
import { Streaks } from './world.js';
import { trafficGeometry } from './glbcars.js';
import { TRAFFIC_GLB, TRAFFIC_KEEP } from './jdmspecs.js';

const glowVert = /* glsl */`
attribute vec3 color;
attribute float size;
uniform float uScale;
varying vec3 vColor;
#include <fog_pars_vertex>
void main(){
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * uScale / -mvPosition.z, 1.5, 26.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const glowFrag = /* glsl */`
varying vec3 vColor;
#include <fog_pars_fragment>
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  // soft halo with a small core: bright enough to read as a lamp, never a blinding blob
  float a = 0.8 * exp(-d * d * 5.5) + 0.22 * exp(-d * d * 60.0);
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <fog_fragment>
}`;

const HEAD_COL = new THREE.Color('#fff1d8');
const TAIL_COL = new THREE.Color('#ff1a26');
const AMBER = new THREE.Color('#ff9a1a');

let AGENT_ID = 0;

export class Traffic {
  constructor(scene, net, world, { count, cruisers, heroSpecs, hq, streaks }) {
    this.scene = scene;
    this.net = net;
    this.world = world;
    this.count = count;
    this.maxCruisers = 0; // the playable cars no longer appear in traffic
    this.heroSpecs = heroSpecs;
    void cruisers;
    this.hq = hq;
    this.agents = [];
    this.radius = 700;
    this.events = [];
    this.heroPool = new Map();
    this._P = {};
    this.time = 0;
    this.trafficNear = 0;
    this.nearestCruiser = null;
    this.nearestTraffic = []; // closest ordinary cars, for their engine / tyre sound
    // modelled traffic (instanced glTF) plus the procedural types that have no model yet
    const TYPES = [...TRAFFIC_GLB, ...TRAFFIC_TYPES.filter(t => TRAFFIC_KEEP.includes(t.id))];
    this.types = TYPES.map(t => ({ ...t, g: t.glb ? trafficGeometry(t) : buildTrafficGeometry(t) }));
    this.totalWeight = this.types.reduce((a, t) => a + t.weight, 0);
    for (const T of this.types) {
      const base = T.g.tintBase || new THREE.Color(1, 1, 1);
      T.palette = (T.colors || ['orig']).map(h => h === 'orig' ? base.clone() : T.shade ? new THREE.Color(h).multiply(base) : new THREE.Color(h));
    }
    const mat = twoTone(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2, envMapIntensity: 0.9 }), '#1c1d22', 0.42, 'traffic');
    // one InstancedMesh per type (procedural) or per type and material (models); tinted parts take a colour per car
    this.meshes = this.types.map(t => {
      const parts = t.g.parts || [{ geo: t.g.geo, mat, tint: true }];
      return parts.map(p => {
        const im = new THREE.InstancedMesh(p.geo, p.mat, count);
        im.count = 0;
        im.frustumCulled = false;
        // no shadow-map pass: every instance in the city would be drawn again; traffic has its own contact shadow
        im.castShadow = false;
        im.userData.tint = p.tint;
        im.userData.axle = p.axle === undefined ? -1 : p.axle;
        if (p.tint) im.setColorAt(0, new THREE.Color(1, 1, 1));
        scene.add(im);
        return im;
      });
    });
    const lampGeo = new THREE.BoxGeometry(0.34, 0.13, 0.06);
    const mkLamp = (n) => {
      const im = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
      im.count = 0; im.frustumCulled = false;
      im.setColorAt(0, new THREE.Color());
      scene.add(im);
      return im;
    };
    this.headIM = mkLamp(count * 2);
    this.tailIM = mkLamp(count * 2);
    this.blinkIM = mkLamp(count * 4);
    this.signIM = mkLamp(count);
    const shGeo = new THREE.PlaneGeometry(1, 1);
    shGeo.rotateX(-Math.PI / 2);
    const shMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, alphaMap: world.tex.glow, polygonOffset: true, polygonOffsetFactor: -2 });
    this.shadowIM = new THREE.InstancedMesh(shGeo, shMat, count);
    this.shadowIM.frustumCulled = false;
    this.shadowIM.count = 0;
    this.shadowIM.renderOrder = 1;
    scene.add(this.shadowIM);
    // glow sprites for every lamp in the scene (traffic, cruisers, player)
    // up to 8 per car (2 head, 2 tail, 4 blinkers) + the player's; at 4 per car the buffer filled up
    // and whichever cars came last in the list lost their lights
    const maxGlow = (count + cruisers + 2) * 8 + 16;
    const gg = new THREE.BufferGeometry();
    this.gPos = new Float32Array(maxGlow * 3);
    this.gCol = new Float32Array(maxGlow * 3);
    this.gSize = new Float32Array(maxGlow);
    gg.setAttribute('position', new THREE.BufferAttribute(this.gPos, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('color', new THREE.BufferAttribute(this.gCol, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('size', new THREE.BufferAttribute(this.gSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 } }]),
      vertexShader: glowVert, fragmentShader: glowFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    });
    gg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.glow = new THREE.Points(gg, this.glowMat);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 5;
    scene.add(this.glow);
    this.glowN = 0;
    this.maxGlow = maxGlow;
    this.streaks = streaks ? new Streaks(maxGlow) : null;
    if (this.streaks) scene.add(this.streaks.mesh);
    this._m4 = new THREE.Matrix4();
    this._mb = new THREE.Matrix4();
    this._mw = new THREE.Matrix4();
    this._ml = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
    // no AI traffic in the parking area (road or bays)
    this.ribWeights = net.ribbons.map(r => r.pa ? 0 : r.len * (r.kind === 'ring' ? 2 : 1));
  }

  setCounts(count, cruisers) {
    this.targetCount = Math.min(count, this.count);
    void cruisers;
  }

  setRadius(r) { this.radius = Math.max(380, r); }

  // --------------------------------------------------------------- spawning
  _pickRibbon(rand = Math.random) {
    const tot = this.ribWeights.reduce((a, b) => a + b, 0);
    let x = rand() * tot;
    for (let i = 0; i < this.ribWeights.length; i++) { x -= this.ribWeights[i]; if (x <= 0) return this.net.ribbons[i]; }
    return this.net.ring;
  }
  _laneFree(rib, dir, s, off, minGap) {
    for (const b of this.agents) {
      if (!b.active || b.rib !== rib) continue;
      if (Math.abs(b.off - off) > 3) continue;
      const d = rib.closed ? wrapDelta(b.s - s, rib.len) : b.s - s;
      if (Math.abs(d) < minGap) return false;
    }
    return true;
  }
  // no car of this direction within `gap` metres along the road, in any lane
  // the lane of this direction with the fewest cars within 300 m (ties at random): keeps every lane equally used
  _quietLane(rib, dir, s) {
    const lanes = rib.lanes[dir], n = new Array(lanes.length).fill(0);
    for (const b of this.agents) {
      if (!b.active || b.rib !== rib || b.dir !== dir) continue;
      const d = rib.closed ? wrapDelta(b.s - s, rib.len) : b.s - s;
      if (Math.abs(d) < 300) n[b.li]++;
    }
    let best = 0, bestN = Infinity;
    const start = Math.floor(Math.random() * lanes.length);
    for (let k = 0; k < lanes.length; k++) {
      const li = (start + k) % lanes.length;
      if (n[li] < bestN) { bestN = n[li]; best = li; }
    }
    return best;
  }
  _rowFree(rib, dir, s, gap) {
    for (const b of this.agents) {
      if (!b.active || b.rib !== rib || b.dir !== dir) continue;
      const d = rib.closed ? wrapDelta(b.s - s, rib.len) : b.s - s;
      if (Math.abs(d) < gap) return false;
    }
    return true;
  }
  _spawnPoint(focus, minD, maxD, tries = 20) {
    for (let t = 0; t < tries; t++) {
      const rib = this._pickRibbon();
      const s = rib.closed ? Math.random() * rib.len : 60 + Math.random() * (rib.len - 260);
      const P = rib.pointAt(s, 0, this._P);
      const d = Math.hypot(P.x - focus.x, P.z - focus.z);
      if (d < minD || d > maxD) continue;
      const dir = rib.lanes[-1] ? (Math.random() < 0.5 ? 1 : -1) : 1;
      const lanes = rib.lanes[dir];
      const li = this._quietLane(rib, dir, s);
      if (!this._laneFree(rib, dir, s, lanes[li], 35) || !this._rowFree(rib, dir, s, 16)) continue;
      return { rib, s, dir, li };
    }
    return null;
  }
  _newAgent(kind) {
    return { id: AGENT_ID++, kind, active: false, v: 0, latV: 0, bump: 0, blink: 0, blinkT: 0, lcT: Math.random() * 2, hazardT: 0, braking: false };
  }
  _initAgent(a, sp, kindOpts = {}) {
    a.rib = sp.rib; a.s = sp.s; a.dir = sp.dir; a.li = sp.li;
    a.off = sp.rib.lanes[sp.dir][sp.li];
    a.targetOff = a.off;
    a.pendingLane = -1;
    a.latV = 0; a.bump = 0; a.blink = 0; a.hazardT = 0; a.shaken = 0; a.merging = 0;
    a.wantExit = Math.random() < (a.kind === 'cruiser' ? 0.35 : 0.15);
    a.active = true;
    a.passSide = 0;
    if (a.kind === 'traffic') {
      // variety: every model of the same kind already within 200 m cuts its chance to 30%
      const nearT = new Array(this.types.length).fill(0), nearC = new Map();
      for (const b of this.agents) {
        if (b === a || !b.active || b.kind !== 'traffic' || b.rib !== a.rib) continue;
        const d = a.rib.closed ? wrapDelta(b.s - a.s, a.rib.len) : b.s - a.s;
        if (Math.abs(d) > 200) continue;
        nearT[b.type]++;
        const k = b.type * 16 + (b.colorIdx || 0);
        nearC.set(k, (nearC.get(k) || 0) + 1);
      }
      // heavy vehicles (the bus) are capped at 5% of the traffic, however rare they are nearby
      let heavyNow = 0;
      for (const b of this.agents) if (b !== a && b.active && b.kind === 'traffic' && b.heavy) heavyNow++;
      const heavyMax = Math.max(2, Math.round((this.targetCount || this.count) * 0.05));
      const w = this.types.map((t, i) => (t.heavy && heavyNow >= heavyMax ? 0 : t.weight * Math.pow(0.3, nearT[i])));
      let x = Math.random() * w.reduce((s, v) => s + v, 0), ti = 0;
      for (; ti < this.types.length; ti++) { x -= w[ti]; if (x <= 0) break; }
      ti = Math.min(ti, this.types.length - 1);
      const T = this.types[ti];
      a.type = ti;
      a.halfL = T.g.halfL; a.halfW = T.g.halfW;
      a.wheelR = T.g.wheelR || 0.3;
      a.spin = Math.random() * 6.28; a.dive = 0;
      a.mass = T.heavy ? 9000 : 1300;
      // colour: the one of this model least seen nearby (ties at random)
      let best = Infinity, ci = 0;
      const order = T.palette.map((_, i) => i).sort(() => Math.random() - 0.5);
      for (const i of order) { const n = nearC.get(ti * 16 + i) || 0; if (n < best) { best = n; ci = i; } }
      a.colorIdx = ci;
      a.color = T.palette[ci].clone();
      a.v0 = (T.v[0] + Math.random() * (T.v[1] - T.v[0])) / 3.6;
      a.aMax = T.heavy ? 1.0 : 1.6 + Math.random() * 0.6;
      a.T = 1.2 + Math.random() * 0.6;
      a.lat = 1.1 + Math.random() * 0.4;
      a.heavy = !!T.heavy;
      // driver personality: calm / normal / sporty
      const r = Math.random();
      a.style = a.heavy ? 0 : r < 0.3 ? 0 : r < 0.8 ? 1 : 2;
      a.v0 *= [0.93, 1, 1.09][a.style];
      a.T = [1.9, 1.5, 1.15][a.style] + Math.random() * 0.3;
      a.aMax *= [0.85, 1, 1.2][a.style];
      a.lat *= [0.85, 1, 1.25][a.style];
      a.polite = [0.7, 0.4, 0.12][a.style];
      a.bSafe = [2.5, 3.5, 4.5][a.style];
    } else {
      a.halfL = a.model.L / 2; a.halfW = a.model.W > 1.5 ? a.model.W / 2 : 1.0;
      a.mass = a.spec.stats.mass;
      a.v0 = kindOpts.v0 || (115 + Math.random() * 80) / 3.6;
      a.baseV0 = a.v0;
      a.aMax = 3.2 + Math.random() * 1.2;
      a.T = 0.7 + Math.random() * 0.3;
      a.lat = 2.4 + Math.random() * 0.6;
      a.mode = kindOpts.mode || 'cruise';
      a.modeT = 20 + Math.random() * 30;
      a.leader = kindOpts.leader || null;
      a.thanked = false;
      a.style = 2; a.polite = 0.05; a.bSafe = 5;
    }
    a.wanderPh = Math.random() * 6.28;
    a.honkT = 2 + Math.random() * 3;
    a.v = kindOpts.v !== undefined ? kindOpts.v : a.v0 * (0.85 + Math.random() * 0.15);
    this._place(a);
  }

  _heroModel(spec) {
    let m = this.heroPool.get(spec.id);
    if (!m) {
      m = new CarModel(spec, { hq: this.hq });
      this.heroPool.set(spec.id, m);
    }
    return m;
  }

  populate(focus) {
    // initial fill across the whole radius
    this.agents.length = 0;
    for (const m of this.heroPool.values()) if (m.group.parent) m.group.parent.remove(m.group);
    const n = this.targetCount || this.count;
    for (let i = 0; i < n; i++) {
      const a = this._newAgent('traffic');
      const sp = this._spawnPoint(focus, 25, this.radius, 40);
      if (!sp) continue;
      this._initAgent(a, sp);
      this.agents.push(a);
    }
    for (let i = 0; i < this.maxCruisers; i++) this._spawnCruiser(focus, null, true);
  }

  _spawnCruiser(focus, player, initial = false) {
    const used = new Set(this.agents.filter(a => a.kind === 'cruiser' && a.active).map(a => a.spec.id));
    const free = this.heroSpecs.filter(s => !used.has(s.id));
    if (!free.length) return;
    const spec = pick(free);
    const a = this._newAgent('cruiser');
    a.spec = spec;
    a.model = this._heroModel(spec);
    if (a.model.setPaint && spec.paints) a.model.setPaint(pick(spec.paints)); // cruisers show up in any of the car's colours
    let sp = null, opts = {};
    // encounter: appear behind the player and overtake
    if (!initial && player && player.speed > 18 && Math.random() < 0.55) {
      const r = player.rib;
      const dirP = this._playerDir(player);
      if (r.lanes[dirP]) {
        const back = 260 + Math.random() * 140;
        let s = player.s - dirP * back;
        if (r.closed) s = wrap(s, r.len);
        if (s > 30 && s < r.len - 60 || r.closed) {
          const lanes = r.lanes[dirP];
          const li = Math.floor(Math.random() * lanes.length);
          if (this._laneFree(r, dirP, s, lanes[li], 30)) {
            sp = { rib: r, s, dir: dirP, li };
            const v0 = clamp(player.speed + 10 + Math.random() * 14, 30, 72);
            opts = { v0, v: v0, mode: 'chase' };
          }
        }
      }
    }
    if (!sp) sp = this._spawnPoint(focus, initial ? 60 : this.radius * 0.6, this.radius * 0.95, 30);
    if (!sp) return;
    this._initAgent(a, sp, opts);
    this.scene.add(a.model.group);
    this.agents.push(a);
    // sometimes a small group
    if (Math.random() < 0.35) {
      const used2 = new Set(this.agents.filter(b => b.kind === 'cruiser' && b.active).map(b => b.spec.id));
      const free2 = this.heroSpecs.filter(s => !used2.has(s.id));
      const nCr = this.agents.filter(b => b.kind === 'cruiser' && b.active).length;
      if (free2.length && nCr < this.maxCruisers + 1) {
        const f = this._newAgent('cruiser');
        f.spec = pick(free2);
        f.model = this._heroModel(f.spec);
        const lanes = sp.rib.lanes[sp.dir];
        const li2 = Math.min(lanes.length - 1, Math.max(0, sp.li + (Math.random() < 0.5 ? 1 : 0)));
        let s2 = sp.s - sp.dir * (18 + Math.random() * 14);
        if (sp.rib.closed) s2 = wrap(s2, sp.rib.len);
        if (s2 > 20 || sp.rib.closed) {
          this._initAgent(f, { rib: sp.rib, s: s2, dir: sp.dir, li: li2 }, { v0: a.v0 + 2, v: a.v, mode: a.mode, leader: a });
          this.scene.add(f.model.group);
          this.agents.push(f);
        }
      }
    }
  }

  _despawn(a) {
    a.active = false;
    if (a.kind === 'cruiser' && a.model.group.parent) a.model.group.parent.remove(a.model.group);
  }

  _playerDir(player) {
    const r = player.rib;
    const P = r.pointAt(player.s, 0, this._P);
    const along = player.vx * P.tx + player.vz * P.tz;
    if (!r.lanes[-1]) return 1;
    if (Math.abs(along) < 3) return player.off < 0 ? 1 : -1;
    return along >= 0 ? 1 : -1;
  }

  // --------------------------------------------------------------- per-frame
  update(dt, player, camera) {
    this.time += dt;
    const focus = player ? player.pos : camera.position;
    this._focus = focus;
    const R2 = this.radius * this.radius;
    this.events.length = 0;
    // obstacle for the player
    let pObs = null;
    if (player) {
      const P = player.rib.pointAt(player.s, 0, this._P);
      const vLat = player.vx * -P.tz + player.vz * P.tx;
      pObs = { player: true, rib: player.rib, s: player.s, off: player.off, offPred: player.off + clamp(vLat * 1.1, -4, 4), halfL: player.halfL, halfW: player.halfW, vAlong: player.vx * P.tx + player.vz * P.tz, x: player.pos.x, z: player.pos.z };
    }
    const list = this.agents;
    // respawn / despawn
    let nTraffic = 0, nCruise = 0;
    for (const a of list) {
      if (!a.active) continue;
      const d2 = (a.x - focus.x) ** 2 + (a.z - focus.z) ** 2;
      if (d2 > R2 * 1.1) { this._despawn(a); continue; }
      if (a.kind === 'traffic') nTraffic++; else nCruise++;
    }
    for (let i = list.length - 1; i >= 0; i--) if (!list[i].active && list[i].kind === 'cruiser') list.splice(i, 1);
    const want = this.targetCount || this.count;
    let budget = 3;
    for (const a of list) {
      if (budget <= 0 || nTraffic >= want) break;
      if (a.active || a.kind !== 'traffic') continue;
      const sp = this._spawnPoint(focus, this.radius * 0.62, this.radius * 0.98, 12);
      if (sp) { this._initAgent(a, sp); nTraffic++; budget--; }
    }
    while (nTraffic < want && list.filter(a => a.kind === 'traffic').length < want && budget > 0) {
      const a = this._newAgent('traffic');
      const sp = this._spawnPoint(focus, this.radius * 0.62, this.radius * 0.98, 12);
      if (!sp) break;
      this._initAgent(a, sp);
      list.push(a);
      nTraffic++; budget--;
    }
    if (nCruise < this.maxCruisers && Math.random() < dt * 0.25) this._spawnCruiser(focus, player);

    // AI
    this.mergers = list.filter(a => a.active && a.merging > 0);
    for (const a of list) if (a.active) this._think(a, dt, pObs, player);
    for (const a of list) {
      if (!a.active) continue;
      this._move(a, dt);
      if (a.kind === 'traffic') {
        // wheels roll with the distance travelled; the body dives a little under braking and squats on throttle
        a.spin = (a.spin + a.v * dt / a.wheelR) % (Math.PI * 2);
        a.dive = damp(a.dive, clamp(-(a.acc || 0) * 0.0045, -0.012, 0.022), 5, dt);
      }
    }
    if (player) this._collide(player, dt);
    this._render(camera, player);
    this._senses(player, camera);
  }

  // lateral conflict: b occupies `off`, or is moving into it
  _overlaps(b, off, halfW) {
    const thr = halfW + b.halfW + 0.35;
    if (Math.abs(b.off - off) <= thr) return true;
    // the player drifting into this lane counts before fully arriving (cut-in anticipation)
    if (b.player) return Math.abs(b.offPred - off) <= thr * 0.8;
    return b.targetOff !== undefined && Math.abs(b.targetOff - off) <= thr && Math.abs(b.off - b.targetOff) > 0.3;
  }
  _gapAhead(a, rib, s, dir, off, halfW, pObs, maxD = 180) {
    let best = null, bestD = maxD;
    const L = rib.len;
    const check = (b) => {
      if (b === a || b.rib !== rib) return;
      if (!this._overlaps(b, off, halfW)) return;
      let d = (b.s - s) * dir;
      if (rib.closed) d = wrapDelta(b.s - s, L) * dir;
      if (d <= 0 || d > bestD) return;
      bestD = d; best = b;
    };
    for (const b of this.agents) if (b.active) check(b);
    if (pObs) check(pObs);
    if (!best) return { gap: Infinity, v: 99, b: null };
    const vB = best.player ? best.vAlong * dir : best.v * (best.dir === dir ? 1 : -1);
    return { gap: bestD - a.halfL - best.halfL, v: vB, b: best };
  }
  _gapBehind(a, rib, s, dir, off, pObs, maxD = 90) {
    let best = null, bestD = maxD;
    const L = rib.len;
    const check = (b) => {
      if (b === a || b.rib !== rib) return;
      if (!this._overlaps(b, off, a.halfW)) return;
      let d = (s - b.s) * dir;
      if (rib.closed) d = wrapDelta(s - b.s, L) * dir;
      if (d <= 0 || d > bestD) return;
      bestD = d; best = b;
    };
    for (const b of this.agents) if (b.active) check(b);
    if (pObs) check(pObs);
    if (!best) return { gap: Infinity, v: 0, b: null };
    const vB = best.player ? best.vAlong * dir : best.v * (best.dir === dir ? 1 : -1);
    return { gap: bestD - a.halfL - best.halfL, v: vB, b: best };
  }

  _think(a, dt, pObs, player) {
    const rib = a.rib, lanes = rib.lanes[a.dir];
    const cruiser = a.kind === 'cruiser';
    // cruiser moods
    if (cruiser) this._mood(a, dt, player, pObs);
    let vDes = a.v0 * (a.shaken > 0 ? 0.55 : 1);
    const k = rib.curvAhead(a.s, a.dir, 60 + a.v * 2.2);
    if (k > 1e-4) vDes = Math.min(vDes, Math.sqrt((cruiser ? 7.5 : 3.2) / k));
    // no side-by-side rows: a car just behind one in the next lane eases off, so traffic staggers
    // and there is always a diagonal gap to weave through
    if (!cruiser && !(a.merging > 0) && lanes.length > 1) {
      for (const b of this.agents) {
        if (b === a || !b.active || b.rib !== rib || b.dir !== a.dir) continue;
        const lat = Math.abs(b.off - a.off);
        if (lat < 2 || lat > 5.5) continue;
        const d = (rib.closed ? wrapDelta(b.s - a.s, rib.len) : b.s - a.s) * a.dir;
        if (d > 0 && d < a.halfL + b.halfL + 12) { vDes *= 0.85; break; }
      }
    }
    let lead = this._gapAhead(a, rib, a.s, a.dir, a.off, a.halfW, pObs);
    if (Math.abs(a.off - a.targetOff) > 0.3) {
      const l2 = this._gapAhead(a, rib, a.s, a.dir, a.targetOff, a.halfW, pObs);
      if (l2.gap < lead.gap) lead = l2;
    }
    // near the end of a link, also see cars that already switched to the ring and wait to merge
    if (rib.kind === 'link' && a.s > rib.len - 320 && this.mergers) {
      for (const m of this.mergers) {
        const dx = m.x - a.x, dz = m.z - a.z;
        const along = dx * a.fx + dz * a.fz, lat = Math.abs(dx * -a.fz + dz * a.fx);
        if (along > 0 && lat < a.halfW + m.halfW + 0.3) {
          const g = along - a.halfL - m.halfL;
          if (g < lead.gap) lead = { gap: g, v: m.v, b: m };
        }
      }
    }
    // waiting on an acceleration lane for a gap in the outer lane
    if (a.merging > 0) {
      a.merging -= dt;
      const off = lanes[a.li];
      const ah = this._gapAhead(a, rib, a.s, a.dir, off, a.halfW, pObs, 60);
      const bh = this._gapBehind(a, rib, a.s, a.dir, off, pObs);
      // never force the merge: wait at the end of the acceleration lane until the gap is safe
      const fAcc = bh.b ? this._idm(bh.b.player ? null : bh.b, bh.v, bh.v + 4, bh.gap, a.v) : 0;
      const playerNear = this._playerBehind(a, off, pObs, 40 + Math.max(0, (pObs ? pObs.vAlong * a.dir : 0) - a.v) * 3, -99);
      if (!playerNear && ah.gap > (a.v < 2 ? 6 : 10) && bh.gap > 4 && fAcc > -3) { a.targetOff = off; a.merging = 0; }
      else if (a.merging < 0.5) a.merging = 0.5;
    }
    // courtesy: let cars coming off an acceleration lane merge in front
    let courtesy = false;
    if (a.li === lanes.length - 1 && this.mergers && this.mergers.length) {
      for (const m of this.mergers) {
        if (m === a || m.rib !== rib || m.dir !== a.dir) continue;
        let d = (m.s - a.s) * a.dir;
        if (rib.closed) d = wrapDelta(m.s - a.s, rib.len) * a.dir;
        if (d > -8 && d < 45) { courtesy = true; break; }
      }
      if (courtesy) vDes *= 1 - 0.25 * a.polite;
    }
    const aM = a.aMax;
    let acc = this._idm(a, a.v, vDes, lead.gap, lead.v, aM);
    // anticipation: react to hard braking two cars ahead through the leader's brake lights
    // (only when close relative to speed, so it does not ripple into phantom jams)
    if (lead.b && !lead.b.player && lead.gap < 8 + a.v * 1.1 && lead.v < a.v + 1) {
      if (lead.b.acc < -3) acc = Math.min(acc, lead.b.acc * 0.4);
      const l2 = lead.b.lead;
      if (l2 && l2.b && !l2.b.player && l2.b.acc < -5 && lead.gap + l2.gap < 12 + a.v * 1.6) acc = Math.min(acc, -1.2);
    }
    // merging at the end of a link: slow down if still blocked near the end of the acceleration lane
    if (a.merging > 0 && a.merging < 3) acc = Math.min(acc, -2.5);
    acc = clamp(acc, -9, aM);
    // Japanese courtesy: hazard flash when braking hard at speed (warns those behind)
    if (acc < -6 && a.v > 19 && lead.b && lead.b.braking && lead.v < a.v - 6 && !(a.hazardT > 0)) a.hazardT = 2.2;
    a.acc = acc;
    a.braking = acc < -0.8 || (a.v < 1 && lead.gap < 10);
    a.lead = lead;
    // how long this car has been stuck behind someone slower (lane changes only after real frustration)
    a.blockedT = lead.gap < 45 && lead.v < vDes - 3 ? (a.blockedT || 0) + dt : 0;
    // honk at a player who cuts in close or brakes hard right in front
    a.honkT -= dt;
    if (lead.b && lead.b.player && lead.gap < 9 && a.v - lead.v > 3.5 && a.honkT <= 0 && a.v > 8) {
      a.honkT = 7 + Math.random() * 6;
      this.events.push({ type: 'honk', x: a.x, z: a.z, heavy: !!a.heavy, style: a.style });
    }

    // no lane changes: every car keeps its lane (ramps still join and leave through the outer lane)
    a.pendingLane = -1;
    if (!(a.merging > 0) && Math.abs(a.off - a.targetOff) < 0.25) a.blink = 0;
  }

  // Intelligent Driver Model acceleration. `a` may be null (the player as follower: generic params).
  _idm(a, v, vDes, gap, vLead, aMaxOverride) {
    const aMax = aMaxOverride || (a ? a.aMax : 2.2), T = a ? a.T : 1.2, s0 = a && a.kind === 'cruiser' ? 3 : 4.5, b = 3;
    let acc = aMax * (1 - Math.pow(Math.max(v, 0) / Math.max(vDes, 1), 4));
    if (gap < 200) {
      const sStar = s0 + Math.max(0, v * T + (v * (v - vLead)) / (2 * Math.sqrt(aMax * b)));
      acc -= aMax * Math.pow(sStar / Math.max(gap, 0.5), 2);
    }
    return acc;
  }

  // lane change is safe if there is room ahead and the new follower would not need to brake hard
  _safeChange(a, rib, off, pObs) {
    const cruiser = a.kind === 'cruiser';
    // never cut in front of the player: no change into their lane when they are close behind or closing
    if (pObs && pObs.rib === rib && this._playerBehind(a, off, pObs, 45 + Math.max(0, pObs.vAlong * a.dir - a.v) * 3.5, -99)) return false;
    const ahead = this._gapAhead(a, rib, a.s, a.dir, off, a.halfW, pObs, 60);
    if (ahead.gap < (cruiser ? 5 : 8) + Math.max(0, a.v - ahead.v) * 0.8) return false;
    const intoFast = off === rib.lanes[a.dir][0] && rib.lanes[a.dir].length > 1;
    const behind = this._gapBehind(a, rib, a.s, a.dir, off, pObs, intoFast ? 150 : 90);
    if (intoFast && (behind.gap < 70 || (a.kind !== 'cruiser' && a.v < 25))) return false;
    if (!behind.b) return true;
    if (behind.gap < (cruiser ? 3 : 5)) return false;
    const fAcc = this._idm(behind.b.player ? null : behind.b, behind.v, behind.v + 4, behind.gap, a.v);
    return fAcc > -(a.bSafe || 3.5);
  }

  // is the player behind `a` (within `range` m) in the lane at `off`, closing at least `minClosing` m/s?
  _playerBehind(a, off, pObs, range, minClosing) {
    if (!pObs || pObs.rib !== a.rib) return false;
    const along = pObs.vAlong * a.dir;
    if (along < -2) return false; // player going the other way
    let d = (a.s - pObs.s) * a.dir;
    if (a.rib.closed) d = wrapDelta(a.s - pObs.s, a.rib.len) * a.dir;
    if (d < -a.halfL - pObs.halfL || d > range) return false;
    const thr = a.halfW + pObs.halfW + 0.5;
    if (Math.abs(pObs.off - off) > thr && Math.abs(pObs.offPred - off) > thr) return false;
    return along - a.v >= minClosing;
  }

  _exitLane(a) {
    if (!a.wantExit) return -1;
    for (const d of this.net.links.diverge) {
      if (d.from !== a.rib || d.dir !== a.dir) continue;
      let dist = (d.s0 - a.s) * a.dir;
      if (a.rib.closed) dist = wrapDelta(d.s0 - a.s, a.rib.len) * a.dir;
      if (dist > -20 && dist < 800) return a.rib.lanes[a.dir].length - 1;
    }
    return -1;
  }

  _mood(a, dt, player, pObs) {
    a.modeT -= dt;
    if (!player) return;
    const sameRib = player.rib === a.rib;
    let rel = 0;
    if (sameRib) rel = a.rib.closed ? wrapDelta(a.s - player.s, a.rib.len) * a.dir : (a.s - player.s) * a.dir; // >0: cruiser ahead of player
    const pDir = this._playerDir(player);
    const together = sameRib && pDir === a.dir && Math.abs(rel) < 80;
    if (a.mode === 'chase') {
      // closing in from behind, then overtake; after passing, thank with hazards once merged ahead
      if (together && rel > 12 && !a.thanked && Math.abs(a.off - player.off) < 2.5) { a.hazardT = 2.2; a.thanked = true; }
      if (together && rel > 25) { a.mode = 'cruise'; a.modeT = 8 + Math.random() * 10; a.v0 = Math.max(player.speed * 1.02, a.v0 * 0.92); }
      if (a.modeT < -40) a.mode = 'cruise';
    } else if (a.mode === 'cruise') {
      if (together && rel > 5 && rel < 45 && player.speed > 22) {
        a.followT = (a.followT || 0) + dt;
        if (a.followT > 2.5 && Math.random() < 0.6) { a.mode = 'pace'; a.modeT = 14 + Math.random() * 22; }
      } else a.followT = 0;
      if (a.modeT <= 0) { a.v0 = a.baseV0 * (0.85 + Math.random() * 0.35); a.modeT = 15 + Math.random() * 25; }
    } else if (a.mode === 'pace') {
      // run just ahead of the player, matching speed; lets them catch up
      const target = player.speed * (rel > 20 ? 0.97 : 1.06) + (rel < 8 ? 3 : 0);
      a.v0 = clamp(target, 20, a.spec.stats.top / 3.6);
      if (!together || a.modeT <= 0) {
        a.mode = 'leave';
        a.modeT = 30;
        const r = Math.random();
        if (r < 0.4) { a.wantExit = true; a.v0 = a.baseV0; }
        else if (r < 0.8) a.v0 = Math.min(a.spec.stats.top / 3.6, player.speed + 18);
        else a.v0 = 22;
      }
    } else if (a.mode === 'leave') {
      if (a.modeT <= 0) { a.mode = 'cruise'; a.modeT = 20; a.v0 = a.baseV0; }
    }
    if (a.leader && a.leader.active && a.leader.rib === a.rib) {
      a.v0 = a.leader.v0 + 1.5;
      if (a.leader.wantExit) a.wantExit = true;
    }
    void pObs;
  }

  _move(a, dt) {
    const rib = a.rib;
    a.v = Math.max(0, a.v + a.acc * dt);
    if (a.shaken > 0) a.shaken -= dt;
    if (a.hazardT > 0) a.hazardT -= dt;
    a.s += a.v * dt * a.dir;
    // lateral
    const maxLat = a.lat * (0.55 + Math.min(1, a.v / 25) * 0.6);
    const want = clamp((a.targetOff - a.off) * 1.3, -maxLat, maxLat);
    a.latV = damp(a.latV, want, 4, dt);
    a.bump = damp(a.bump, 0, 3, dt);
    a.off += (a.latV + a.bump) * dt;
    if (!Number.isFinite(a.s + a.off + a.v)) { this._despawn(a); return; }
    // safety valve: a car stuck for a long time out of the player's sight is recycled
    a.stuckT = a.v < 0.3 ? (a.stuckT || 0) + dt : 0;
    if (a.stuckT > 8 && a.kind === 'traffic' && this._focus && (a.x - this._focus.x) ** 2 + (a.z - this._focus.z) ** 2 > 90 * 90) { this._despawn(a); return; }
    // diverge / merge
    if (rib.closed) a.s = wrap(a.s, rib.len);
    else if (a.s > rib.len - 2) { this._despawn(a); return; }
    for (const d of this.net.links.diverge) {
      if (d.from !== rib || d.dir !== a.dir || !a.wantExit) continue;
      // the lane on the ramp's side (the outer one unless the link says otherwise)
      if (a.li !== (d.li !== undefined ? d.li : rib.lanes[a.dir].length - 1)) continue;
      const lo = Math.min(d.s0, d.s1), hi = Math.max(d.s0, d.s1);
      if (a.s >= lo && a.s <= hi) this._switch(a, d.to, 1, 0);
    }
    for (const m of this.net.links.merge) {
      if (m.from !== rib) continue;
      if (a.s > m.sFrom) {
        const lanes = m.to.lanes[m.dir];
        this._switch(a, m.to, m.dir, m.li !== undefined ? m.li : lanes.length - 1);
        a.targetOff = a.off; // hold on the acceleration lane until the outer lane is clear
        a.merging = 6;
        a.wantExit = Math.random() < 0.2;
      }
    }
    this._place(a);
  }

  _place(a) {
    // drivers never hold the lane centre perfectly: a slow, small wander
    const w = a.kind === 'traffic' && Math.abs(a.off - a.targetOff) < 0.2 ? Math.sin(this.time * 0.35 + (a.wanderPh || 0)) * 0.13 : 0;
    const P = a.rib.pointAt(a.s, a.off + w, this._P);
    a.x = P.x; a.y = P.y; a.z = P.z;
    const tx = P.tx * a.dir, tz = P.tz * a.dir;
    const yawRoad = Math.atan2(tx, tz);
    // lateral motion turns the car slightly; the ribbon's right vector flips with direction
    const latAngle = Math.atan2((a.latV + a.bump) * a.dir, Math.max(a.v, 2));
    a.yaw = yawRoad - latAngle;
    a.pitch = Math.atan(P.slope * a.dir);
    a.fx = Math.sin(a.yaw); a.fz = Math.cos(a.yaw);
  }

  _switch(a, to, dir, li) {
    const P = a.rib.pointAt(a.s, a.off, this._P);
    const q = to.projectGlobal(P.x, P.z);
    a.rib = to; a.s = q.s; a.off = q.off; a.dir = dir;
    a.li = li;
    a.targetOff = to.lanes[dir][li];
    a.blink = Math.sign((a.targetOff - a.off) * dir);
    a.pendingLane = -1;
    if (a.kind === 'cruiser' && a.mode === 'leave') a.wantExit = false;
    // on a link some drivers take one of its own exits (the C2 now has ramps to both directions)
    else if (to.kind === 'link') a.wantExit = !to.ramp && Math.random() < 0.3;
  }

  // --------------------------------------------------------------- player collisions
  _collide(player, dt) {
    const px = player.pos.x, pz = player.pos.z;
    const pfx = Math.sin(player.yaw), pfz = Math.cos(player.yaw);
    const rad = player.halfW * 0.95;
    const reach = player.halfL - rad * 0.7;
    for (const a of this.agents) {
      if (!a.active) continue;
      const dx0 = a.x - px, dz0 = a.z - pz;
      if (dx0 * dx0 + dz0 * dz0 > 120 || Math.abs(a.y - player.y) > 3) continue;
      const rx = -a.fz, rz = a.fx;
      for (const k of [-1, 0, 1]) {
        const cx = px + pfx * reach * k, cz = pz + pfz * reach * k;
        const lx = (cx - a.x) * rx + (cz - a.z) * rz; // lateral in agent frame (right)
        const lz = (cx - a.x) * a.fx + (cz - a.z) * a.fz; // longitudinal
        const qx = clamp(lx, -a.halfW, a.halfW), qz = clamp(lz, -a.halfL, a.halfL);
        let ddx = lx - qx, ddz = lz - qz;
        let dist = Math.hypot(ddx, ddz);
        if (dist >= rad) continue;
        if (dist < 1e-4) {
          // center inside the box: push out along the smallest axis
          const ex = a.halfW - Math.abs(lx), ez = a.halfL - Math.abs(lz);
          if (ex < ez) { ddx = Math.sign(lx) || 1; ddz = 0; dist = -ex; } else { ddz = Math.sign(lz) || 1; ddx = 0; dist = -ez; }
        } else { ddx /= dist; ddz /= dist; }
        const pen = rad - dist;
        const nx = rx * ddx + a.fx * ddz, nz = rz * ddx + a.fz * ddz; // world normal from agent to player
        player.pos.x += nx * pen * 0.85;
        player.pos.z += nz * pen * 0.85;
        const avx = a.fx * a.v, avz = a.fz * a.v;
        const vrel = (player.vx - avx) * nx + (player.vz - avz) * nz;
        if (vrel < 0) {
          const mp = player.stats.mass, ma = a.mass;
          const j = (-(1 + 0.3) * vrel) / (1 / mp + 1 / ma);
          player.applyImpulse(nx * j / mp, nz * j / mp, clamp(-vrel / 14, 0, 1));
          const ia = -j / ma;
          a.v = Math.max(0, a.v + ia * (nx * a.fx + nz * a.fz));
          const T = a.rib.pointAt(a.s, 0, this._P);
          const lat = (nx * -T.tz + nz * T.tx) * ia;
          a.bump += clamp(lat, -4, 4);
          if (-vrel > 3) { a.hazardT = 6; a.shaken = 6; if (a.kind === 'cruiser') a.mode = 'leave'; }
          this.events.push({ type: 'impact', strength: clamp(-vrel / 14, 0, 1) });
        }
      }
    }
    void dt;
  }

  // --------------------------------------------------------------- rendering
  _render(camera, player) {
    const m4 = this._m4, q = this._q, e = this._e, v = this._v, sc = this._s, c = this._c;
    const counts = new Array(this.types.length).fill(0);
    let nh = 0, nt = 0, nb = 0, ns = 0, nsh = 0;
    this.glowN = 0;
    if (this.streaks) this.streaks.begin();
    const blinkOn = (this.time % 0.8) < 0.42;
    const cam = camera.position;
    const lampLocal = (a, arr, k) => arr[k];
    for (const a of this.agents) {
      if (!a.active) continue;
      e.set(-a.pitch, a.yaw, 0, 'YXZ');
      q.setFromEuler(e);
      v.set(a.x, a.y, a.z);
      m4.compose(v, q, sc);
      const hazard = a.hazardT > 0;
      const left = (a.blink < 0 || hazard) && blinkOn, right = (a.blink > 0 || hazard) && blinkOn;
      const dxC = cam.x - a.x, dzC = cam.z - a.z;
      const dC = Math.hypot(dxC, dzC) || 1;
      const facing = (a.fx * dxC + a.fz * dzC) / dC; // >0: front faces camera
      if (a.kind === 'traffic') {
        const T = this.types[a.type];
        const idx = counts[a.type]++;
        const g = T.g;
        // body on its springs (pitch only, about the ground centre); the wheels stay on the road and roll
        const mb = this._mb.multiplyMatrices(m4, this._ml.makeRotationX(a.dive || 0));
        for (const im of this.meshes[a.type]) {
          const k = im.userData.axle;
          if (k >= 0) {
            const ax = g.axles[k];
            this._mw.makeRotationX(a.spin || 0).setPosition(0, ax.y, ax.z);
            im.setMatrixAt(idx, this._mw.premultiply(m4));
          } else im.setMatrixAt(idx, mb);
          if (im.userData.tint) im.setColorAt(idx, a.color);
        }
        const boxes = !T.glb; // modelled cars carry their own lamps: glows only, no lamp boxes on the surface
        for (let k = 0; k < 2; k++) {
          const h = g.head[k], t = g.tail[k];
          if (boxes) {
            this._lamp(this.headIM, nh++, m4, h[0], h[1], h[2], c.copy(HEAD_COL).multiplyScalar(1.05));
            this._lamp(this.tailIM, nt++, m4, t[0], t[1], t[2], c.copy(TAIL_COL).multiplyScalar(a.braking ? 3.4 : 1.1));
          }
          this._glowAt(m4, h[0], h[1], h[2], HEAD_COL, (0.12 + Math.max(0, facing) * 0.55), 0.8);
          this._glowAt(m4, t[0], t[1], t[2], TAIL_COL, (a.braking ? 0.8 : 0.3) * (0.3 + Math.max(0, -facing)), a.braking ? 0.8 : 0.55);
        }
        // blinkers
        const bs = [[g.tail[0][0] + 0.12, g.tail[0][1] - 0.12, g.tail[0][2], left], [g.tail[1][0] - 0.12, g.tail[1][1] - 0.12, g.tail[1][2], right], [g.head[0][0] + 0.12, g.head[0][1] - 0.12, g.head[0][2], left], [g.head[1][0] - 0.12, g.head[1][1] - 0.12, g.head[1][2], right]];
        for (const [x, y, z, on] of bs) if (on) { if (boxes) this._lamp(this.blinkIM, nb++, m4, x, y, z, c.copy(AMBER).multiplyScalar(1.8)); this._glowAt(m4, x, y, z - Math.sign(z) * 0.06, AMBER, 0.5, 0.55); }
        if (g.sign) this._lamp(this.signIM, ns++, m4, g.sign[0], g.sign[1], g.sign[2], c.set('#ffb347').multiplyScalar(1.1), 1.4, 1.4, 3);
        // contact shadow
        e.set(0, a.yaw, 0, 'YXZ'); q.setFromEuler(e);
        v.set(a.x, a.y + 0.03, a.z);
        sc.set(a.halfW * 2 + 0.8, 1, a.halfL * 2 + 0.8);
        m4.compose(v, q, sc);
        this.shadowIM.setMatrixAt(nsh++, m4);
        sc.set(1, 1, 1);
      } else {
        const g = a.model.group;
        g.position.set(a.x, a.y, a.z);
        g.rotation.set(-a.pitch, a.yaw, 0, 'YXZ');
        a.model.updateWheels(1 / 60, a.v, -clamp(a.latV * 0.08, -0.3, 0.3));
        a.model.setLights({ head: true, brake: a.braking, left, right });
        // detailed cruiser models only up close; far away (a few pixels) the lamp glows alone read as the car
        g.visible = dC < Math.min(this.radius, 320);
        for (const h of a.model.headLocal) this._glowAt(m4, h.x, h.y, h.z, HEAD_COL, 0.12 + Math.max(0, facing) * 0.6, 0.85);
        for (const t of a.model.tailLocal) this._glowAt(m4, t.x, t.y, t.z, TAIL_COL, (a.braking ? 0.85 : 0.35) * (0.3 + Math.max(0, -facing)), a.braking ? 0.85 : 0.6);
        this._blinkGlows(m4, a.model, left, right);
      }
    }
    // player lamps
    if (player) {
      player.model.group.updateMatrixWorld();
      const pm = player.model.group.matrixWorld;
      const f = player.lights.head ? 1 : 0.15;
      for (const h of player.model.headLocal) this._glowAt(pm, h.x, h.y, h.z, HEAD_COL, 0.25 * f, 0.7);
      for (const t of player.model.tailLocal) this._glowAt(pm, t.x, t.y, t.z, TAIL_COL, player.braking ? 0.7 : 0.25, player.braking ? 0.75 : 0.5);
      if (player.model.blink) this._blinkGlows(pm, player.model, player.model.blink.left, player.model.blink.right);
    }
    this.types.forEach((t, i) => {
      for (const im of this.meshes[i]) {
        im.count = counts[i];
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    });
    for (const [im, n] of [[this.headIM, nh], [this.tailIM, nt], [this.blinkIM, nb], [this.signIM, ns], [this.shadowIM, nsh]]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    const gg = this.glow.geometry;
    gg.setDrawRange(0, this.glowN);
    gg.attributes.position.needsUpdate = true;
    gg.attributes.color.needsUpdate = true;
    gg.attributes.size.needsUpdate = true;
    if (this.streaks) { this.streaks.end(); this.streaks.mat.uniforms.uCam.value.copy(cam); }
    void lampLocal;
  }
  _lamp(im, i, m4, x, y, z, col, sx = 1, sy = 1, sz = 1) {
    if (i >= im.instanceMatrix.count) return;
    const v = this._v2 || (this._v2 = new THREE.Vector3());
    const mm = this._m42 || (this._m42 = new THREE.Matrix4());
    mm.copy(m4);
    v.set(x, y, z).applyMatrix4(m4);
    mm.setPosition(v);
    if (sx !== 1 || sy !== 1 || sz !== 1) mm.scale((this._sv || (this._sv = new THREE.Vector3())).set(sx, sy, sz));
    im.setMatrixAt(i, mm);
    im.setColorAt(i, col);
  }
  // amber indicator glows at the outer edge of a modelled car's head and tail lamps (+x is the car's left)
  _blinkGlows(m4, model, left, right) {
    if (!left && !right) return;
    for (const p of [...model.headLocal, ...model.tailLocal]) {
      if (p.x > 0 ? !left : !right) continue;
      // just outside the lens (a glow, not geometry), so the body does not hide it
      this._glowAt(m4, p.x + Math.sign(p.x) * 0.1, p.y, p.z + Math.sign(p.z) * 0.08, AMBER, 1.25, 0.8);
    }
  }
  _glowAt(m4, x, y, z, col, intensity, size) {
    if (this.glowN >= this.maxGlow || intensity <= 0.01) return;
    const v = this._v3 || (this._v3 = new THREE.Vector3());
    v.set(x, y, z).applyMatrix4(m4);
    if (!Number.isFinite(v.x + v.y + v.z)) return;
    const i = this.glowN++;
    this.gPos[i * 3] = v.x; this.gPos[i * 3 + 1] = v.y; this.gPos[i * 3 + 2] = v.z;
    this.gCol[i * 3] = col.r * intensity; this.gCol[i * 3 + 1] = col.g * intensity; this.gCol[i * 3 + 2] = col.b * intensity;
    this.gSize[i] = size;
    if (this.streaks && intensity > 0.3) {
      const c2 = this._c2 || (this._c2 = new THREE.Color());
      this.streaks.push(v.x, v.y - (y - 0.06), v.z, c2.copy(col).multiplyScalar(intensity * 0.3), 0.5, 5);
    }
  }

  // --------------------------------------------------------------- senses (audio cues, minimap)
  _senses(player, camera) {
    let near = 0, best = null, bestD = 60;
    const nt = this.nearestTraffic;
    nt.length = 0;
    if (!player) { this.trafficNear = 0; this.nearestCruiser = null; return; }
    const px = player.pos.x, pz = player.pos.z;
    const pfx = Math.sin(player.yaw), pfz = Math.cos(player.yaw);
    const crx = -pfz, crz = pfx;
    for (const a of this.agents) {
      if (!a.active) continue;
      const dx = a.x - px, dz = a.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < 45) near++;
      const lonRel = dx * pfx + dz * pfz;
      const side = Math.sign(lonRel) || 1;
      if (d < 14 && Math.abs(a.y - player.y) < 4) {
        if (a.passSide && a.passSide !== side) {
          const rv = Math.abs(a.v * (a.fx * pfx + a.fz * pfz) - player.speed);
          if (rv > 6) this.events.push({ type: 'pass', intensity: clamp(rv / 30, 0.2, 1) * (a.heavy ? 1.4 : 1), pan: clamp((dx * crx + dz * crz) / 8, -1, 1) });
        }
        a.passSide = side;
      } else a.passSide = 0;
      if (a.kind !== 'cruiser' && d < 70 && Math.abs(a.y - player.y) < 7) {
        const closing = -((a.fx * a.v - player.vx) * dx + (a.fz * a.v - player.vz) * dz) / (d || 1);
        nt.push({ key: a, dist: d, pan: (dx * crx + dz * crz) / (d || 1), closing, speed: a.v, acc: a.acc || 0, heavy: a.heavy, type: a.type });
      }
      if (a.kind === 'cruiser' && d < bestD) {
        bestD = d;
        const closing = -((a.fx * a.v - player.vx) * dx + (a.fz * a.v - player.vz) * dz) / (d || 1);
        best = { dist: d, pan: (dx * crx + dz * crz) / (d || 1), closing, speed: a.v, sound: a.spec.sound };
      }
    }
    nt.sort((p, q) => p.dist - q.dist);
    if (nt.length > 4) nt.length = 4;
    this.trafficNear = near;
    this.nearestCruiser = best;
    void camera;
  }

  setGlowScale(renderer, camera) {
    const h = renderer.domElement.height;
    this.glowMat.uniforms.uScale.value = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }

  dispose() {
    for (const a of this.agents) this._despawn(a);
    for (const m of this.meshes.flat()) this.scene.remove(m);
    for (const im of [this.headIM, this.tailIM, this.blinkIM, this.signIM, this.shadowIM, this.glow]) this.scene.remove(im);
    if (this.streaks) this.scene.remove(this.streaks.mesh);
    for (const m of this.heroPool.values()) if (m.group.parent) m.group.parent.remove(m.group);
  }
}
