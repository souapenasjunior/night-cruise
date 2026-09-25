// Road network: ribbons (sampled centerlines with width), spatial grid, surface queries and the map layout.
import * as THREE from 'three';
import { clamp, wrap, lerp } from './util.js';

// ------------------------------------------------------------------ cross-sections
// Every width derives from these: lanes stay 3.6 m, the shoulders set the rest. Offsets from the centre line.
export const LANE_W = 3.6;
export const PARAPET_W = 0.4;   // edge parapet, standing on the deck's outermost 0.4 m
export const BARRIER_HW = 0.35; // median barrier, half its base
// loop: median barrier, 1.2 m clear to the yellow line, three lanes, and 1.0 m from the edge line to the
// parapet: no shoulder (the edge strip only keeps a car from scraping the wall)
const RING_YELLOW = BARRIER_HW + 1.2;
export const RING_X = {
  yellow: RING_YELLOW,
  lanes: [0, 1, 2].map(k => RING_YELLOW + LANE_W * (k + 0.5)), // fast lane first
  edge: RING_YELLOW + 3 * LANE_W, // edge line
  hw: RING_YELLOW + 3 * LANE_W + 1.0,
};
// the PA's roads: 2 lanes and a 1.0 m edge strip each side
export const LINK_X = { lanes: [LANE_W / 2, -LANE_W / 2], edge: LANE_W, hw: LANE_W + 1.0 };
export const RING_HW = RING_X.hw;
export const RAMP_HW = LINK_X.hw;
// ramp centre when its two lanes lie on the loop's two outer lanes (the end of every taper)
export const MERGED = (RING_X.lanes[1] + RING_X.lanes[2]) / 2;
// decks that run alongside overlap by this much (edge to edge), so the seam between them is pavement
const OVERLAP = 1.0;

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
    this.edge = opts.edge; // edge line: outer edge of the outermost lane
    const curve = new THREE.CatmullRomCurve3(opts.points, this.closed, 'centripetal', 0.5);
    // arc length measured finely (a few times per metre; three's default is 200 divisions per curve, 25 m
    // apart on a 5 km road), so the samples really are ds apart: uneven spacing made the grade jump
    let rough = 0;
    for (let k = 1; k < opts.points.length; k++) rough += opts.points[k].distanceTo(opts.points[k - 1]);
    curve.arcLengthDivisions = Math.max(200, Math.ceil(rough * 3));
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
    // cross slope (dy per metre of lateral offset): zero, except where a deck lies on a road it crosses
    // at an angle and takes that road's surface (see drape)
    this.cs = new Float32Array(n);
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
    out.y = lerp(this.py[i], this.py[j], t) + off * lerp(this.cs[i], this.cs[j], t);
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
    out.y = lerp(this.py[i], this.py[j], tc) + out.off * lerp(this.cs[i], this.cs[j], tc);
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
  // the parapet on side sg (-1 / +1) at s, if any (intervals from buildWalls; on a closed ribbon an
  // interval may run past len, and s is then reported in its frame)
  wallSpan(sg, s) {
    const list = this.walls && this.walls[sg];
    if (!list) return null;
    if (this.closed) s = wrap(s, this.len);
    for (const w of list) {
      if (s >= w.s0 && s <= w.s1) return { w, s };
      if (this.closed && s + this.len <= w.s1) return { w, s: s + this.len };
    }
    return null;
  }
  wallAt(sg, s) { return !!this.wallSpan(sg, s); }
}

// ------------------------------------------------------------------ levels
// Decks whose surfaces meet within this height at a point are one surface there (a ramp on the loop,
// the PA's roads on each other and on the bays); anything further apart is another level.
export const LEVEL_TOL = 0.6;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// Vertical alignment: a spline through control points that also turn hard in plan spreads the climb
// unevenly (a ripple in the grade at a control point). Each link's height profile is smoothed with a
// Gaussian (sigma in metres) before anything is fitted to it; flat or even grades are left unchanged.
function smoothProfile(r, sigma) {
  const n = r.n, w = Math.ceil((2.5 * sigma) / r.ds), y = Float64Array.from(r.py);
  const k = Array.from({ length: 2 * w + 1 }, (_, j) => Math.exp(-0.5 * (((j - w) * r.ds) / sigma) ** 2));
  for (let i = 0; i < n; i++) {
    // (symmetric window, shrinking at the ends so they keep their height and grade)
    const h = Math.min(w, i, n - 1 - i);
    let a = 0, b = 0;
    for (let j = -h; j <= h; j++) { a += k[j + w] * y[i + j]; b += k[j + w]; }
    r.py[i] = a / b;
  }
  r._frames();
}

// Where a deck lies on an earlier one (lower id: the loop, then the PA's access road...), it
// takes that deck's surface exactly: its height and, where it crosses at an angle, the cross slope of
// that deck's plane along this deck's cross-section. Outside the overlap the correction fades out over
// DRAPE_BLEND metres, carrying its own rate of change at the boundary (Hermite), so the grade flows on
// with no kink. Two decks sharing a spot therefore never differ in height (no step for the wheels, no
// lip in the drawing), and each deck records the decks it lies on, which sets its drawing layer.
const DRAPE_BLEND = 40;
function drape(net) {
  const res = [];
  for (const r of net.ribbons) {
    r.layer = 0;
    r.hosts = new Set();
    if (r.id === 0) continue;
    const n = r.n, da = new Float64Array(n).fill(NaN), db = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      // (most samples are nowhere near an earlier deck: one query across the whole width rules it out)
      if (!net.surfacesAt(r.px[i], r.pz[i], r.py[i], LEVEL_TOL + 0.5, r.hw, res).some(c => c.r.id < r.id)) continue;
      const lx = -r.tz[i], lz = r.tx[i]; // this deck's lateral axis
      let m = 0, sa = 0, sb = 0;
      for (let k = -4; k <= 4; k++) {
        const o = (k / 4) * r.hw;
        const x = r.px[i] + lx * o, z = r.pz[i] + lz * o;
        let q = null;
        for (const c of net.surfacesAt(x, z, r.py[i] + o * r.cs[i], LEVEL_TOL, 0, res)) if (c.r.id < r.id && (!q || c.r.id < q.r.id)) q = c;
        if (!q) continue;
        r.hosts.add(q.r.id);
        // the host's plane along this deck's lateral axis: its grade times the part of the axis along
        // it, plus its own cross slope times the part across it
        const h = q.r, j = h.next(q.i), t = clamp(q.t, 0, 1);
        const b = lerp(h.sl[q.i], h.sl[j], t) * (lx * q.tx + lz * q.tz) + lerp(h.cs[q.i], h.cs[j], t) * (lx * -q.tz + lz * q.tx);
        m++; sb += b; sa += q.y - b * o;
      }
      if (!m) continue;
      da[i] = sa / m - r.py[i];
      db[i] = sb / m - r.cs[i];
    }
    const blend = arr => {
      const out = Float64Array.from(arr), ds = r.ds;
      const slope = (i, d) => (i - d >= 0 && i - d < n && !Number.isNaN(arr[i - d]) ? (arr[i] - arr[i - d]) / (d * ds) : 0);
      let i = 0;
      while (i < n) {
        if (!Number.isNaN(arr[i])) { i++; continue; }
        let j = i;
        while (j < n && Number.isNaN(arr[j])) j++;
        const l = i - 1, rr = j < n ? j : -1; // defined neighbours
        const cl = l >= 0 ? arr[l] : 0, gl = l >= 0 ? slope(l, 1) : 0;
        const cr = rr >= 0 ? arr[rr] : 0, gr = rr >= 0 ? slope(rr, -1) : 0; // (rates: per metre, increasing s)
        const D = (rr >= 0 && l >= 0) ? (rr - l) * ds : Infinity;
        for (let k = i; k < j; k++) {
          if (D < 2 * DRAPE_BLEND) {
            // cubic Hermite between the two ends (values and rates)
            const t = (k - l) * ds / D, t2 = t * t, t3 = t2 * t;
            out[k] = (2 * t3 - 3 * t2 + 1) * cl + (t3 - 2 * t2 + t) * D * gl + (-2 * t3 + 3 * t2) * cr + (t3 - t2) * D * gr;
          } else {
            const dl = (k - l) * ds, dr = (rr - k) * ds;
            out[k] = (l >= 0 ? (cl + gl * dl) * (1 - smooth(dl / DRAPE_BLEND)) : 0) + (rr >= 0 ? (cr - gr * dr) * (1 - smooth(dr / DRAPE_BLEND)) : 0);
          }
        }
        i = j;
      }
      return out;
    };
    const ca = blend(da), cb = blend(db);
    for (let i = 0; i < n; i++) { r.py[i] += ca[i]; r.cs[i] += cb[i]; }
    r._frames();
    // drawn under every deck it lies on: overlapping decks never share a layer
    for (const h of r.hosts) r.layer = Math.max(r.layer, net.ribbons[h].layer + 1);
  }
  net.layers = Math.max(...net.ribbons.map(r => r.layer)) + 1;
}

// ------------------------------------------------------------------ walls
// The drivable area is the union of the decks at one level. A parapet stands exactly on its boundary:
// along a deck's edge wherever that edge is not inside another deck at the same level, cut where the
// edge enters or leaves the other deck (found by bisection, to the millimetre). The drawing (world.js)
// and the car's collision (player.js) both read these intervals, so every wall seen is a wall felt and
// every wall felt is seen; two decks never both wall the same stretch, and walls never stand in a lane.
// A wall end is square where another deck's wall carries on from it (a taper: the loop's parapet hands
// over to the ramp's), or where it meets a parking bay's end wall; otherwise it slopes down (chamfer).
export const CHAMFER = 4;
const EDGE_EPS = 0.01;
function buildWalls(net) {
  const res = [];
  // the edge point of r at s on side sg lies inside another deck: no wall there
  const covered = (r, sg, s) => {
    const E = r.pointAt(r.wrapS(s), sg * r.hw);
    for (const q of net.surfacesAt(E.x, E.z, E.y, LEVEL_TOL, EDGE_EPS, res)) {
      if (q.r === r) continue;
      // a parking bay's two ends are its end walls (0.4 m thick), not pavement
      if (q.r.kind === 'lot' && (q.s < PARAPET_W || q.s > q.r.len - PARAPET_W)) continue;
      const a = Math.abs(q.off);
      // edges running exactly together: the earlier deck keeps the wall
      if (a < q.r.hw - EDGE_EPS || q.r.id < r.id) return q.r;
    }
    return null;
  };
  for (const r of net.ribbons) {
    r.walls = { [-1]: [], 1: [] };
    for (const sg of [-1, 1]) {
      const n = r.n, open = new Uint8Array(n);
      for (let i = 0; i < n; i++) open[i] = covered(r, sg, i * r.ds) ? 1 : 0;
      if (!open.some(v => v)) { r.walls[sg].push({ s0: 0, s1: r.closed ? r.len : r.len, full: r.closed }); continue; }
      // bisect a boundary between s = a (state of a) and b
      const cut = (a, b) => {
        const va = !!covered(r, sg, a);
        for (let k = 0; k < 18; k++) { const m = (a + b) / 2; if (!!covered(r, sg, m) === va) a = m; else b = m; }
        return (a + b) / 2;
      };
      // walk the samples (closed: start just after an open one)
      const i0 = r.closed ? open.indexOf(1) : 0;
      const cnt = r.closed ? n : n;
      let cur = null;
      for (let k = 0; k < cnt; k++) {
        const i = r.closed ? (i0 + k) % n : k;
        const sI = (r.closed ? i0 + k : k) * r.ds;
        const prevOpen = k === 0 ? (r.closed ? 1 : null) : open[r.closed ? (i0 + k - 1) % n : k - 1];
        if (!open[i] && !cur) cur = { s0: prevOpen === null ? 0 : cut(sI - r.ds, sI) };
        if (open[i] && cur) { cur.s1 = cut(sI - r.ds, sI); r.walls[sg].push(cur); cur = null; }
      }
      if (cur) {
        if (r.closed) { cur.s1 = cut((i0 + n) * r.ds - r.ds, (i0 + n) * r.ds); } else cur.s1 = r.len;
        r.walls[sg].push(cur);
      }
      for (const w of r.walls[sg]) if (r.closed && w.s0 >= r.len) { w.s0 -= r.len; w.s1 -= r.len; }
    }
  }
  // parking bays: each end wall runs from the back wall across the bay to where the first other deck
  // begins (the access road, or a ramp passing over the bay's corner). endIn[k]: that lateral offset
  // at end k (0: s = 0, 1: s = len), for the drawing and the collision alike
  for (const r of net.ribbons) {
    if (r.kind !== 'lot') continue;
    r.endIn = [PARAPET_W / 2, r.len - PARAPET_W / 2].map(sE => {
      for (let o = r.outer * r.hw; o * r.outer > -r.hw; o -= r.outer * 0.02) {
        const P = r.pointAt(sE, o);
        if (net.surfacesAt(P.x, P.z, P.y, LEVEL_TOL, 0, res).some(q => q.r !== r && q.r.kind !== 'lot')) return o;
      }
      return -r.outer * (r.hw - OVERLAP);
    });
  }
  // end shapes (second pass: needs every deck's walls)
  for (const r of net.ribbons) {
    for (const sg of [-1, 1]) {
      for (const w of r.walls[sg]) {
        if (w.full) { w.e0 = w.e1 = 'square'; continue; }
        for (const [end, out] of [['e0', -1], ['e1', 1]]) {
          const sE = end === 'e0' ? w.s0 : w.s1;
          if (!r.closed && (sE <= 1e-3 || sE >= r.len - 1e-3)) { w[end] = 'square'; continue; }
          // what covers the edge just past the end
          const q = covered(r, sg, sE + out * 0.6);
          if (q && q.kind === 'lot') { w[end] = 'square'; continue; }
          // does another deck's wall carry on from here? (its edge passes the end point, walled beyond it)
          const X = r.pointAt(r.wrapS(sE), sg * r.hw), Y = r.pointAt(r.wrapS(sE + out * 1.5), sg * r.hw);
          let cont = false;
          for (const c of net.surfacesAt(X.x, X.z, X.y, LEVEL_TOL, 0.6, res)) {
            if (c.r === r || Math.abs(Math.abs(c.off) - c.r.hw) > 0.5) continue;
            const pr = c.r.projectLocal(Y.x, Y.z, c.i, 6, {});
            if (c.r.wallAt(Math.sign(c.off), pr.s)) { cont = true; break; }
          }
          w[end] = cont ? 'square' : 'chamfer';
        }
      }
    }
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
    name: 'ring', label: 'K1', closed: true, hw: RING_HW, kind: 'ring', median: true, points: pts, edge: RING_X.edge,
    lanes: { 1: RING_X.lanes.map(o => -o), [-1]: RING_X.lanes.slice() },
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
  const side = RING_HW + RAMP_HW - OVERLAP; // ramp centre when it runs alongside the loop
  // points running alongside the loop. taperTo: an acceleration lane that slides into the loop over
  // the last points; taperFrom: a deceleration lane that starts inside the loop and slides out over
  // the first points. Either way the ramp's end lies entirely on the loop's pavement, its two lanes
  // on the loop's two outer lanes, so nothing ends in a wall.
  const par = (s0, dir, off, count = 6, step = 30, taperTo = null, taperFrom = null) => {
    const out = [];
    // quintic ease: curvature starts and ends at zero (no sudden steering input at speed)
    const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);
    for (let k = 0; k < count; k++) {
      const s = S(s0 + dir * k * step);
      let o = off;
      if (taperTo !== null && k >= 2) o = lerp(off, taperTo, smooth((k - 2) / (count - 3)));
      if (taperFrom !== null && k <= count - 3) o = lerp(taperFrom, off, smooth(k / (count - 3)));
      out.push(rp(s, o, ringY(s)));
    }
    return out;
  };
  const merged = MERGED; // ramp centre when fully on the loop: its lanes = the loop's two outer lanes
  const link = (o) => ({ hw: RAMP_HW, edge: LINK_X.edge, lanes: { 1: LINK_X.lanes.slice() }, ...o });

  // Nishi PA: a parking area inside the loop between Nishi Straight and Minato Bayside, where the loop
  // is flat and gently curved, reachable at speed from both directions.
  //  - dir+ (interior side): a 120 m deceleration lane, then a long S (R ~300 m) that eases 3.5 m down
  //    to the PA level and onto its access road, 56 m inside the loop; the mirror S climbs back to a
  //    120 m acceleration lane.
  //  - dir- (exterior side): paIn peels off after the PA, drifts out and down, crosses diagonally under
  //    the loop and the dir+ exit and runs straight onto the far end of the access road; paOut leaves
  //    its near end the same way and joins dir- ahead of the PA. No hairpins, no U-turns: the access
  //    road is two-way (only the player uses the PA; traffic stays on the loop).
  // Everything is symmetric about d = PA_C (d: distance along the loop from sP).
  const sP = S(nearestS(-1925, 0) + 150);
  // bay cross-section from the back: parapet 0.4, walkway 3.2 (keeps the chase camera inside), stall 5.2,
  // 0.8 to the aisle, 1.0 overlapping the access road
  const PA_D = 56, LOT_HW = 5.3, LOT_LEN = 52, WALK = 3.2;
  const PA_Y = ringY(sP) - 3.5; // the PA deck sits lower, so the dir- ramps pass under the loop on easy grades
  const LOW = 5.5; // the dir- ramps' underpass level: 4.6 m under the loop's deck (surface ~12, 1.8 m deep)
  const PA_C = 475, CORR = 55; // access road straight: PA_C +- CORR
  // lateral ease for the S bends: quintic, so the curvature builds up from zero and dies back to zero
  const cosE = t => { t = Math.min(1, Math.max(0, t)); return t * t * t * (t * (t * 6 - 15) + 10); };
  const smoothE = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  const at = (d, off, y) => rp(S(sP + d), off, y);
  const ringYd = d => ringY(S(sP + d));
  // samples d0..d1 (exclusive of d0) of a lateral/height law
  const run = (d0, d1, step, offF, yF) => {
    const out = [], n = Math.max(1, Math.round(Math.abs(d1 - d0) / step));
    for (let k = 1; k <= n; k++) { const d = d0 + (d1 - d0) * k / n; out.push(at(d, offF(d), yF(d))); }
    return out;
  };
  const dIn = PA_C - CORR, dOut = PA_C + CORR, S_LEN = 240, TAPER = 180;
  // dir+ : height eases down over the entry S, holds on the straight, eases back up over the exit S
  const paY = d => {
    if (d <= dIn - S_LEN || d >= dOut + S_LEN) return ringYd(d);
    if (d >= dIn && d <= dOut) return PA_Y;
    const t = d < dIn ? (dIn - d) / S_LEN : (d - dOut) / S_LEN; // 0 at the straight, 1 at the loop
    return lerp(PA_Y, ringYd(d), smoothE((t - 0.36) / 0.5)); // level with the loop before they touch
  };
  const paOff = d => d < dIn ? lerp(-side, -PA_D, cosE((d - (dIn - S_LEN)) / S_LEN))
    : d > dOut ? lerp(-PA_D, -side, cosE((d - dOut) / S_LEN)) : -PA_D;
  const paRoad = net.add(new Ribbon(link({
    name: 'pa', label: 'PA', kind: 'pa', step: 2,
    points: [
      ...par(S(sP + dIn - S_LEN - TAPER), 1, -side, 10, 20, null, -merged),
      ...run(dIn - S_LEN, dOut + S_LEN, 20, paOff, paY),
      ...par(S(sP + dOut + S_LEN + 20), 1, -side, 10, 20, -merged),
    ],
  })));
  paRoad.pa = true;
  // the bays overlap the access road by 1 m, so the edge between them is open (no parapet, drive straight in)
  const lots = [-1, 1].map(k => {
    const off = -PA_D + k * (RAMP_HW + LOT_HW - OVERLAP);
    const pts = [];
    for (let d = -LOT_LEN / 2; d <= LOT_LEN / 2 + 0.01; d += LOT_LEN / 4) pts.push(at(PA_C + d, off, PA_Y));
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
  // dir- ramps, described from the access road outwards (e: distance from the road's end, along the loop).
  // They start 4 m into the bays and 0.8 m toward the inner bay, on top of the access road (so its
  // edge and the bays' end walls leave no stub of parapet), run straight on until the dir+ S has
  // swung clear, then descend and cross.
  const J = PA_D + 0.8;
  const E_FLAT = 140, E_LOW0 = 245, E_LOW1 = 440, E_S1 = 490, E_TOP = 710, E_S2 = 790, E_PAR = E_S2 + 180, OUT = 30;
  const dOff = e => e <= E_FLAT ? -J : e <= E_S1 ? lerp(-J, OUT, cosE((e - E_FLAT) / (E_S1 - E_FLAT))) : lerp(OUT, side, cosE((e - E_S1) / (E_S2 - E_S1)));
  const dY = (e, d) => e <= E_FLAT - 55 ? PA_Y
    : e <= E_LOW0 ? lerp(PA_Y, LOW, smoothE((e - (E_FLAT - 55)) / (E_LOW0 - E_FLAT + 55)))
      : e <= E_LOW1 ? LOW : lerp(LOW, ringYd(d), smoothE((e - E_LOW1) / (E_TOP - E_LOW1))); // level with the loop before they touch
  const E_START = -(CORR - LOT_LEN / 2 + 4); // 4 m into the bays
  const dirMinus = sgn => {
    // sgn +1: the far side (paIn, listed from the loop inwards); -1: the near side (paOut, from the road outwards)
    const d0 = sgn > 0 ? dOut : dIn;
    const dAt = e => d0 + sgn * e;
    const pts = [];
    for (let e = E_START; e < E_S2 - 1; e += 20) pts.push(at(dAt(e), dOff(e), dY(e, dAt(e))));
    pts.push(at(dAt(E_S2), side, ringYd(dAt(E_S2))));
    return pts;
  };
  const inPts = dirMinus(1).reverse();
  const paIn = net.add(new Ribbon(link({
    name: 'paIn', label: 'PA', kind: 'pa', step: 2,
    points: [...par(S(sP + dOut + E_PAR), -1, side, 10, 20, null, merged), ...inPts.slice(1)],
  })));
  const paOut = net.add(new Ribbon(link({
    name: 'paOut', label: 'PA', kind: 'pa', step: 2,
    points: [...dirMinus(-1), ...par(S(sP + dIn - E_S2 - 20), -1, side, 10, 20, merged)],
  })));
  paIn.pa = paOut.pa = true;
  net.pa = { road: paRoad, lots, slots, bays: perLot, stallW: STALL_W, stallD: STALL_D, sExit: S(sP + dIn - S_LEN - TAPER), paIn, paOut };
  // signs inside the PA (placed by signage.js): at each end of the access road a gantry naming the way
  // out for drivers heading that way, and a NO ENTRY sign at the mouth of the branch that only comes in
  const sPa = d => { const Q = at(d, -PA_D); return paRoad.projectGlobal(Q.x, Q.z).s; };
  net.pa.signs = [
    { kind: 'paexit', r: paRoad, s: sPa(dOut - 20), d: 1, dest: 1, arrow: 45 },
    { kind: 'paexit', r: paRoad, s: sPa(dIn + 20), d: -1, dest: -1, arrow: 0 },
    { kind: 'noentry', r: paIn, s: paIn.len - (-E_START + 35), d: -1 },
    { kind: 'noentry', r: paRoad, s: sPa(dIn - 35), d: -1 },
  ];

  // median U-turn gaps
  const g1 = nearestS(1350, -985), g2 = nearestS(-1150, 1130);
  ring.medianGaps = [[g1 - 25, g1 + 25], [g2 - 25, g2 + 25]];

  // no AI on connecting roads (traffic stays on the loop)
  net.links = { diverge: [], merge: [] };

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
    { r: paRoad, s: paRoad.len / 2, name: 'Nishi PA', jp: '西パーキング' },
    ...lots.map(lot => ({ r: lot, s: lot.len / 2, name: 'Nishi PA', jp: '西パーキング' })),
  ];

  net.buildGrid();
  for (const r of net.ribbons) if (!r.closed && r.kind !== 'lot') smoothProfile(r, 10);
  drape(net);
  buildWalls(net);
  return net;
}
