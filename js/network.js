// Road network: ribbons (sampled centerlines with width), spatial grid, surface queries and the map layout.
import * as THREE from 'three';
import { clamp, wrap, lerp } from './util.js';

export const LANE_W = 3.6;
export const RING_HW = 13.9; // median 1.1 + 3 lanes + 2.0 shoulder
export const RAMP_HW = 5.6;  // 2 lanes + shoulders

export class Ribbon {
  constructor(opts) {
    this.id = -1;
    this.name = opts.name;
    this.label = opts.label || opts.name;
    this.closed = !!opts.closed;
    this.hw = opts.hw;
    this.kind = opts.kind;
    this.median = !!opts.median;
    this.medianGaps = opts.medianGaps || [];
    this.lanes = opts.lanes; // {1:[offsets], -1:[offsets]}; index 0 = fast lane
    const curve = new THREE.CatmullRomCurve3(opts.points, this.closed, 'centripetal', 0.5);
    const len = curve.getLength();
    const step = opts.step || 4;
    const segs = Math.max(2, Math.round(len / step));
    const pts = curve.getSpacedPoints(segs);
    const n = this.closed ? segs : segs + 1;
    this.n = n;
    this.len = len;
    this.ds = len / segs;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.sl = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = pts[i].x;
      this.py[i] = pts[i].y;
      this.pz[i] = pts[i].z;
    }
    this._frames();
  }
  _frames() {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      let a = i - 1, b = i + 1;
      if (this.closed) { a = (a + n) % n; b = b % n; } else { a = Math.max(0, a); b = Math.min(n - 1, b); }
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
      this.sl[i] = (this.py[b] - this.py[a]) / l;
    }
    // curvature (1/m), used by AI to pick safe corner speeds
    this.curv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let a = i - 2, b = i + 2;
      if (this.closed) { a = (a + n) % n; b = b % n; } else { a = Math.max(0, a); b = Math.min(n - 1, b); }
      let d = Math.atan2(this.tz[b], this.tx[b]) - Math.atan2(this.tz[a], this.tx[a]);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.curv[i] = Math.abs(d) / (4 * this.ds);
    }
  }
  // max curvature over [s, s+ahead] in travel direction dir
  curvAhead(s, dir, ahead) {
    let m = 0;
    for (let d = 0; d <= ahead; d += 8) {
      let u = (s + dir * d) / this.ds;
      if (this.closed) u = wrap(u, this.n); else if (u < 0 || u > this.n - 1) break;
      const c = this.curv[Math.floor(u)];
      if (c > m) m = c;
    }
    return m;
  }
  next(i) { return this.closed ? (i + 1) % this.n : Math.min(i + 1, this.n - 1); }
  wrapS(s) { return this.closed ? wrap(s, this.len) : clamp(s, 0, this.len); }
  pointAt(s, off = 0, out = {}) {
    let u = s / this.ds;
    if (this.closed) u = wrap(u, this.n);
    else u = clamp(u, 0, this.n - 1 - 1e-6);
    const i = Math.floor(u), t = u - i, j = this.next(i);
    let tx = lerp(this.tx[i], this.tx[j], t), tz = lerp(this.tz[i], this.tz[j], t);
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    out.x = lerp(this.px[i], this.px[j], t) - tz * off;
    out.z = lerp(this.pz[i], this.pz[j], t) + tx * off;
    out.y = lerp(this.py[i], this.py[j], t);
    out.tx = tx; out.tz = tz;
    out.slope = lerp(this.sl[i], this.sl[j], t);
    out.i = i;
    return out;
  }
  // project onto segment i (i -> next). Returns raw t (unclamped), and fills out
  segProject(i, x, z, out) {
    const j = this.next(i);
    const ax = this.px[i], az = this.pz[i];
    const dx = this.px[j] - ax, dz = this.pz[j] - az;
    const L2 = dx * dx + dz * dz || 1e-6;
    const t = ((x - ax) * dx + (z - az) * dz) / L2;
    const tc = clamp(t, 0, 1);
    const cx = ax + dx * tc, cz = az + dz * tc;
    const L = Math.sqrt(L2);
    out.off = ((x - cx) * -dz + (z - cz) * dx) / L;
    out.dist = Math.hypot(x - cx, z - cz);
    out.t = t;
    out.i = i;
    out.s = (i + tc) * this.ds;
    out.y = lerp(this.py[i], this.py[j], tc);
    out.tx = dx / L; out.tz = dz / L;
    return t;
  }
  // local search around a sample hint
  projectLocal(x, z, iHint, win = 12, out = {}) {
    const tmp = {};
    let best = Infinity;
    const segs = this.closed ? this.n : this.n - 1;
    for (let k = -win; k <= win; k++) {
      let i = iHint + k;
      if (this.closed) i = ((i % segs) + segs) % segs;
      else if (i < 0 || i >= segs) continue;
      this.segProject(i, x, z, tmp);
      if (tmp.dist < best) { best = tmp.dist; Object.assign(out, tmp); }
    }
    return out;
  }
  projectGlobal(x, z, out = {}) {
    const tmp = {};
    let best = Infinity;
    const segs = this.closed ? this.n : this.n - 1;
    for (let i = 0; i < segs; i += 4) {
      this.segProject(i, x, z, tmp);
      if (tmp.dist < best) { best = tmp.dist; Object.assign(out, tmp); }
    }
    return this.projectLocal(x, z, out.i, 8, out);
  }
  inMedianGap(s) {
    for (const g of this.medianGaps) if (s >= g[0] && s <= g[1]) return true;
    return false;
  }
}

export class Network {
  constructor() {
    this.ribbons = [];
    this.cell = 48;
    this.grid = new Map();
    this._res = [];
    this._tmp = {};
  }
  add(r) { r.id = this.ribbons.length; this.ribbons.push(r); this._res.push({}); return r; }
  _key(cx, cz) { return (cx + 2048) * 4096 + (cz + 2048); }
  buildGrid() {
    const c = this.cell;
    for (const r of this.ribbons) {
      const segs = r.closed ? r.n : r.n - 1;
      for (let i = 0; i < segs; i++) {
        const j = r.next(i), m = r.hw + 2;
        const x0 = Math.floor((Math.min(r.px[i], r.px[j]) - m) / c), x1 = Math.floor((Math.max(r.px[i], r.px[j]) + m) / c);
        const z0 = Math.floor((Math.min(r.pz[i], r.pz[j]) - m) / c), z1 = Math.floor((Math.max(r.pz[i], r.pz[j]) + m) / c);
        for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
          const k = this._key(gx, gz);
          let a = this.grid.get(k);
          if (!a) { a = []; this.grid.set(k, a); }
          a.push(r.id * 1000000 + i);
        }
      }
    }
  }
  // All ribbons whose surface contains (x,z) within `extra` of their half width, near height yHint (tol).
  surfacesAt(x, z, yHint, tol = 3, extra = 0, out = []) {
    out.length = 0;
    const list = this.grid.get(this._key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return out;
    const res = this._res, tmp = this._tmp;
    for (let k = 0; k < res.length; k++) res[k].dist = Infinity;
    for (let k = 0; k < list.length; k++) {
      const code = list[k];
      const rid = Math.floor(code / 1000000), i = code - rid * 1000000;
      const r = this.ribbons[rid];
      const t = r.segProject(i, x, z, tmp);
      const segs = r.closed ? r.n : r.n - 1;
      const lo = !r.closed && i === 0 ? 0 : -0.15;
      const hi = !r.closed && i === segs - 1 ? 1 : 1.15;
      if (t < lo || t > hi) continue;
      if (Math.abs(tmp.y - yHint) > tol) continue;
      if (tmp.dist < res[rid].dist) Object.assign(res[rid], tmp, { r });
    }
    for (let k = 0; k < res.length; k++) {
      const q = res[k];
      if (q.dist < Infinity && Math.abs(q.off) <= q.r.hw + extra) out.push(q);
    }
    return out;
  }
  // Minimum horizontal distance to any ribbon edge-ish (used for placement clearance); ignores height.
  // `skip(r)` leaves ribbons out of the test.
  clearance(x, z, margin, skip = null) {
    const c = this.cell;
    const r0 = Math.ceil(margin / c);
    const gx = Math.floor(x / c), gz = Math.floor(z / c);
    const tmp = this._tmp;
    for (let a = -r0; a <= r0; a++) for (let b = -r0; b <= r0; b++) {
      const list = this.grid.get(this._key(gx + a, gz + b));
      if (!list) continue;
      for (const code of list) {
        const rid = Math.floor(code / 1000000), i = code - rid * 1000000;
        const r = this.ribbons[rid];
        if (skip && skip(r)) continue;
        r.segProject(i, x, z, tmp);
        if (tmp.dist < r.hw + margin) return false;
      }
    }
    return true;
  }
}

// ------------------------------------------------------------------ layout
const RING_PTS = [
  [-1600, 950, 12], [-1150, 1130, 13], [-650, 1200, 18], [-200, 1275, 29], [300, 1305, 33],
  [800, 1275, 29], [1200, 1150, 18], [1550, 950, 13], [1800, 650, 13], [1740, 390, 14], [1890, 130, 14],
  [1830, -300, 14], [1660, -700, 16], [1350, -985, 12], [900, -1150, 7], [400, -1235, 2.2],
  [-150, -1255, 2.2], [-650, -1205, 2.6], [-1100, -1080, 9], [-1500, -850, 12], [-1800, -500, 12],
  [-1925, -50, 12], [-1885, 450, 12],
];

export function buildNetwork() {
  const net = new Network();
  let pts = RING_PTS.map(p => new THREE.Vector3(p[0], p[2], p[1]));
  // ensure the loop interior lies on the -right side of the travel direction
  const test = new Ribbon({ name: 't', closed: true, hw: RING_HW, points: pts, step: 20 });
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p.x; cz += p.z; }
  cx /= pts.length; cz /= pts.length;
  const rx = -test.tz[0], rz = test.tx[0];
  if (rx * (cx - test.px[0]) + rz * (cz - test.pz[0]) > 0) pts = pts.reverse();

  const ring = new Ribbon({
    name: 'ring', label: 'K1', closed: true, hw: RING_HW, kind: 'ring', median: true, points: pts,
    lanes: { 1: [-2.9, -6.5, -10.1], [-1]: [2.9, 6.5, 10.1] },
  });
  net.add(ring);
  net.ring = ring;

  const nearestS = (x, z) => ring.projectGlobal(x, z).s;
  const P = {};
  const rp = (s, off, y) => {
    ring.pointAt(s, off, P);
    return new THREE.Vector3(P.x, y === undefined ? P.y : y, P.z);
  };
  const ringY = s => ring.pointAt(s, 0, P).y;
  const L = ring.len;
  const S = v => wrap(v, L);
  const sA = S(nearestS(-1925, 0) - 760);
  const sB = S(nearestS(1890, 60) + 760);
  const side = RING_HW + RAMP_HW - 1.0;

  // central link centerline
  const c0 = rp(S(sA + 760), -250, 15);
  const cN = rp(S(sB - 760), -250, 15);
  const mid = [];
  const dirX = cN.x - c0.x, dirZ = cN.z - c0.z;
  const dl = Math.hypot(dirX, dirZ);
  const nx = -dirZ / dl, nz = dirX / dl;
  const wig = [[0.2, 90, 21], [0.4, -140, 26], [0.6, -60, 27], [0.8, 110, 22]];
  const center = [c0];
  for (const [f, w, y] of wig) center.push(new THREE.Vector3(c0.x + dirX * f + nx * w, y, c0.z + dirZ * f + nz * w));
  center.push(cN);
  const cc = new THREE.CatmullRomCurve3(center, false, 'centripetal');
  const cpts = cc.getSpacedPoints(26);
  const deckPlus = [], deckMinus = [];
  for (let i = 0; i < cpts.length; i++) {
    const a = cpts[Math.max(0, i - 1)], b = cpts[Math.min(cpts.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz);
    tx /= l; tz /= l;
    const rX = -tz, rZ = tx;
    // the two roadways run 18 m apart mid-deck, wider (26 m) where the ramps swing in, so the
    // opposite carriageways never touch (they overlapped by up to 4.5 m, with no parapet between)
    const e = Math.min(i, cpts.length - 1 - i), D = e <= 2 ? 13 : e === 3 ? 11 : 9;
    deckPlus.push(new THREE.Vector3(cpts[i].x - rX * D, cpts[i].y, cpts[i].z - rZ * D));
    deckMinus.push(new THREE.Vector3(cpts[i].x + rX * D, cpts[i].y, cpts[i].z + rZ * D));
  }
  // points running alongside the loop. taperTo: an acceleration lane that slides into the loop over
  // the last points; taperFrom: a deceleration lane that starts inside the loop and slides out over
  // the first points. Either way the ramp's end lies entirely on the loop's pavement, its two lanes
  // on the loop's two outer lanes, so nothing ends in a wall.
  const par = (s0, dir, off, count = 6, step = 30, taperTo = null, taperFrom = null) => {
    const out = [];
    const smooth = t => t * t * (3 - 2 * t);
    for (let k = 0; k < count; k++) {
      const s = S(s0 + dir * k * step);
      let o = off;
      if (taperTo !== null && k >= 2) o = lerp(off, taperTo, smooth((k - 2) / (count - 3)));
      if (taperFrom !== null && k <= count - 3) o = lerp(taperFrom, off, smooth(k / (count - 3)));
      out.push(rp(s, o, ringY(s)));
    }
    return out;
  };
  const merged = RING_HW - RAMP_HW; // ramp centre when fully on the loop: its lanes = the loop's two outer lanes

  // C+ : leaves dir+ at A (interior side), crosses the city, merges into dir+ at B
  const cPlusPts = [
    ...par(sA, 1, -side, 6, 30, null, -merged),
    rp(S(sA + 215), -24, ringY(S(sA + 215)) + 0.3),
    rp(S(sA + 330), -60, ringY(S(sA + 330)) + 1),
    rp(S(sA + 560), -160, 14),
    ...deckPlus.slice(1, -1),
    rp(S(sB - 560), -160, 14),
    rp(S(sB - 330), -60, ringY(S(sB - 330)) + 1),
    rp(S(sB - 215), -24, ringY(S(sB - 215)) + 0.3),
    ...par(S(sB - 150), 1, -side, 8, 30, -merged),
  ];
  // C- : leaves dir- at B (exterior), dives under the loop, crosses the city, dives under again, merges into dir- at A
  const yb = ringY(S(sB - 500));
  const ya = ringY(S(sA + 650));
  const cMinusPts = [
    ...par(S(sB - 350), -1, side, 6, 30, null, merged),
    rp(S(sB - 565), side + 10, yb - 1.2),
    rp(S(sB - 640), 70, yb - 4.5),
    rp(S(sB - 725), 92, 6.5),
    rp(S(sB - 800), 76, 3.8),
    rp(S(sB - 835), 34, 2.2),
    rp(S(sB - 840), -12, 1.6),
    rp(S(sB - 815), -90, 4.5),
    ...deckMinus.slice().reverse().slice(1, -1),
    rp(S(sA + 880), -90, 4.5),
    rp(S(sA + 905), -12, 1.6),
    rp(S(sA + 900), 30, 2.4),
    rp(S(sA + 870), 72, 4.5),
    rp(S(sA + 795), 90, 7.5),
    rp(S(sA + 720), 66, ya - 2.2),
    rp(S(sA + 660), side + 10, ya - 0.6),
    ...par(S(sA + 610), -1, side, 8, 30, merged),
  ];
  const cPlus = net.add(new Ribbon({ name: 'c2e', label: 'C2', hw: RAMP_HW, kind: 'link', points: cPlusPts, lanes: { 1: [1.8, -1.8] } }));
  const cMinus = net.add(new Ribbon({ name: 'c2w', label: 'C2', hw: RAMP_HW, kind: 'link', points: cMinusPts, lanes: { 1: [1.8, -1.8] } }));

  // Nishi PA: a parking area off the loop on the dir+ (interior) side, between Nishi Straight and
  // Minato Bayside, where the loop is elevated, flat and gently curved. A deceleration lane peels off,
  // the access road runs 56 m inside the loop with a parking bay on each side (cars back into the
  // stalls, facing the aisle), and an acceleration lane merges back like the C2 ramps do.
  const sP = S(sA + 1060);
  // bay cross-section from the back: parapet 0.4, walkway 3.2 (keeps the chase camera inside), stall 5.2,
  // 0.8 to the aisle, 1.0 overlapping the access road
  const PA_D = 56, LOT_HW = 5.3, LOT_LEN = 52, WALK = 3.2;
  const paRoad = net.add(new Ribbon({
    name: 'pa', label: 'PA', hw: RAMP_HW, kind: 'pa', lanes: { 1: [1.8, -1.8] }, step: 2,
    points: [
      ...par(sP, 1, -side, 5, 30, null, -merged),
      rp(S(sP + 165), -30), rp(S(sP + 200), -46),
      rp(S(sP + 235), -PA_D), rp(S(sP + 250), -PA_D), rp(S(sP + 280), -PA_D), rp(S(sP + 310), -PA_D), rp(S(sP + 345), -PA_D),
      rp(S(sP + 390), -44), rp(S(sP + 440), -27),
      ...par(S(sP + 500), 1, -side, 7, 30, -merged),
    ],
  }));
  paRoad.pa = true;
  // the bays overlap the access road by 1 m, so the edge between them is open (no parapet, drive straight in)
  const lots = [-1, 1].map(k => {
    const off = -PA_D + k * (RAMP_HW + LOT_HW - 1);
    const pts = [];
    for (let d = -LOT_LEN / 2; d <= LOT_LEN / 2 + 0.01; d += LOT_LEN / 4) pts.push(rp(S(sP + 280 + d), off));
    const lot = net.add(new Ribbon({ name: 'lot', label: 'PA', hw: LOT_HW, kind: 'lot', lanes: { 1: [0] }, points: pts, step: 2 }));
    lot.pa = true;
    lot.outer = k; // lateral side away from the aisle: the stalls' back wall
    return lot;
  });
  // stalls: 2.9 m wide, 5.2 m deep from the back parapet; the car stands in the middle, nose to the aisle
  const STALL_W = 2.9, STALL_D = 5.2;
  const slots = [];
  const perLot = lots.map(lot => {
    const n = Math.floor((lot.len - 3) / STALL_W);
    const s0 = (lot.len - n * STALL_W) / 2;
    const wall = lot.outer * (LOT_HW - 0.4), back = wall - lot.outer * WALK;
    return { lot, n, s0, wall, back, front: back - lot.outer * STALL_D };
  });
  // fill order: the bay away from the loop first, then alternate, from the entry end
  for (let k = 0; k < Math.max(...perLot.map(p => p.n)); k++) {
    for (const p of [perLot[0], perLot[1]]) {
      if (k >= p.n) continue;
      slots.push({ rib: p.lot, s: p.s0 + (k + 0.5) * STALL_W, off: p.back - p.lot.outer * STALL_D / 2, face: -p.lot.outer });
    }
  }
  net.pa = { road: paRoad, lots, slots, bays: perLot, stallW: STALL_W, stallD: STALL_D, sExit: sP };

  // median U-turn gaps
  const g1 = nearestS(1350, -985), g2 = nearestS(-1150, 1130);
  ring.medianGaps = [[g1 - 25, g1 + 25], [g2 - 25, g2 + 25]];

  // links for AI
  net.links = {
    diverge: [
      { from: ring, dir: 1, s0: S(sA + 10), s1: S(sA + 110), to: cPlus, sideSign: -1 },
      { from: ring, dir: -1, s0: S(sB - 360), s1: S(sB - 460), to: cMinus, sideSign: 1 },
    ],
    merge: [
      { from: cPlus, to: ring, dir: 1, sFrom: cPlus.len - 140 },
      { from: cMinus, to: ring, dir: -1, sFrom: cMinus.len - 140 },
    ],
  };
  net.sA = sA; net.sB = sB;

  // named zones along ribbons
  const zone = (x, z) => nearestS(x, z);
  net.zones = [
    { r: ring, s: zone(-1600, 950), name: 'Minato Bayside', jp: '港湾線' },
    { r: ring, s: zone(-450, 1240), name: 'Kaigan Bridge', jp: '海岸大橋' },
    { r: ring, s: zone(1400, 1060), name: 'Shiodome Curve', jp: '汐留カーブ' },
    { r: ring, s: zone(1850, 300), name: 'Higashi Downtown', jp: '東都心' },
    { r: ring, s: zone(1500, -850), name: 'Kita Junction', jp: '北ジャンクション' },
    { r: ring, s: zone(700, -1190), name: 'Kita Tunnel', jp: '北トンネル' },
    { r: ring, s: zone(-1300, -980), name: 'Nishi Industrial', jp: '西工業地帯' },
    { r: ring, s: zone(-1900, 200), name: 'Nishi Straight', jp: '西ストレート' },
    { r: cPlus, s: 250, name: 'C2 Central Link', jp: '中央連絡線' },
    { r: cMinus, s: 400, name: 'C2 Central Link', jp: '中央連絡線' },
    { r: paRoad, s: paRoad.len / 2, name: 'Nishi PA', jp: '西パーキング' },
    ...lots.map(lot => ({ r: lot, s: lot.len / 2, name: 'Nishi PA', jp: '西パーキング' })),
  ];

  net.buildGrid();
  return net;
}
