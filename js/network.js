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
// C2, ramps and the PA: 2 lanes and a 1.0 m edge strip each side
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
// a ramp blending into C2, the PA's roads on the bays); anything further apart is another level.
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

// Where a deck lies on an earlier one (lower id: the loop, then C2, then the PA's access road...), it
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
  const sA = S(nearestS(-1925, 0) - 760);
  const sB = S(nearestS(1890, 60) + 760);
  const side = RING_HW + RAMP_HW - OVERLAP; // ramp centre when it runs alongside the loop

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
  const merged = MERGED; // ramp centre when fully on the loop: its lanes = the loop's two outer lanes

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
  const link = (o) => ({ hw: RAMP_HW, edge: LINK_X.edge, lanes: { 1: LINK_X.lanes.slice() }, ...o });
  const cPlus = net.add(new Ribbon(link({ name: 'c2e', label: 'C2', kind: 'link', points: cPlusPts })));
  const cMinus = net.add(new Ribbon(link({ name: 'c2w', label: 'C2', kind: 'link', points: cMinusPts })));

  // Nishi PA: a parking area off the loop on the dir+ (interior) side, between Nishi Straight and
  // Minato Bayside, where the loop is elevated, flat and gently curved. A deceleration lane peels off,
  // the access road runs 56 m inside the loop with a parking bay on each side (cars back into the
  // stalls, facing the aisle), and an acceleration lane merges back like the C2 ramps do.
  const sP = S(sA + 1060);
  // bay cross-section from the back: parapet 0.4, walkway 3.2 (keeps the chase camera inside), stall 5.2,
  // 0.8 to the aisle, 1.0 overlapping the access road
  const PA_D = 56, LOT_HW = 5.3, LOT_LEN = 52, WALK = 3.2;
  const paRoad = net.add(new Ribbon(link({
    name: 'pa', label: 'PA', kind: 'pa', step: 2,
    points: [
      ...par(sP, 1, -side, 5, 30, null, -merged),
      rp(S(sP + 165), -30), rp(S(sP + 200), -46),
      rp(S(sP + 235), -PA_D), rp(S(sP + 250), -PA_D), rp(S(sP + 280), -PA_D), rp(S(sP + 310), -PA_D), rp(S(sP + 345), -PA_D),
      rp(S(sP + 390), -44), rp(S(sP + 440), -27),
      ...par(S(sP + 500), 1, -side, 7, 30, -merged),
    ],
  })));
  paRoad.pa = true;
  // the bays overlap the access road by 1 m, so the edge between them is open (no parapet, drive straight in)
  const lots = [-1, 1].map(k => {
    const off = -PA_D + k * (RAMP_HW + LOT_HW - OVERLAP);
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
  // Access from the other direction (dir -1, outside the loop), so everyone meets in the same bays.
  // paIn: leaves dir- well ahead, runs as a collector outside the loop, hairpins under the loop behind
  // the PA's entry end and climbs to join the access road before the bays.
  // paOut: leaves the access road after the bays, dips under the PA exit road and the loop, turns back
  // outside and joins dir- with an acceleration lane on its two outer lanes.
  // Underpasses at y ~5.3: 4.7 m below the loop's deck (surface 11.9, 1.8 m deep).
  const pp = (d, off, y) => rp(S(sP + d), off, y);
  // the same point at the access road's own height (+dy): where paIn/paOut overlap the access road
  // their decks must lie exactly on it, or the join shows a step
  const ppOn = (d, off, dy = 0) => {
    const Q = pp(d, off), pr = paRoad.projectGlobal(Q.x, Q.z);
    Q.y = paRoad.pointAt(pr.s, 0).y + dy;
    return Q;
  };
  const paIn = net.add(new Ribbon(link({
    name: 'paIn', label: 'PA', kind: 'pa', step: 2,
    points: [
      ...par(S(sP + 900), -1, side, 5, 30, null, merged),
      pp(700, 50, 9.6), pp(640, 80, 7.9), pp(580, 95, 6.7), pp(480, 97, 6.0), pp(380, 97, 5.8),
      pp(280, 97, 5.7), pp(180, 95, 5.6), pp(100, 85, 5.5), pp(40, 60, 5.4), pp(5, 30, 5.3),
      pp(-8, 0, 5.3), pp(-5, -30, 5.4), pp(15, -52, 5.9), pp(50, -66, 6.9), pp(95, -72, 8.3),
      // climbs to the access road's level before the two decks touch, then blends in on top of it,
      // keeping 0.6-1 m toward the bays until it is over them: its edge covers the access road's edge
      // right up to the first bay's end wall (no stub of parapet left between the two)
      pp(140, -71, 10.3), ppOn(175, -67.5, -0.25), ppOn(200, -63.5), ppOn(222, -60), ppOn(238, -58), ppOn(250, -57), ppOn(258, -56.6),
    ],
  })));
  const paOut = net.add(new Ribbon(link({
    name: 'paOut', label: 'PA', kind: 'pa', step: 2,
    points: [
      // leaves on top of the access road, and only drops once the two decks have parted
      // (both overlap the bays by a few metres, so no stub of access-road parapet is left between)
      ppOn(302, -56), ppOn(310, -56.3), ppOn(322, -57.5), ppOn(338, -60.5), ppOn(354, -65), ppOn(372, -70, -0.3), pp(400, -75, 10.8),
      pp(440, -76, 9.3), pp(478, -72, 8.1), pp(515, -60, 6.8), pp(550, -40, 5.7), pp(578, -12, 5.2),
      pp(590, 18, 5.2), pp(582, 46, 5.6), pp(558, 64, 6.4), pp(520, 70, 7.5), pp(482, 62, 8.7),
      pp(450, 46, 9.9), pp(422, 32, 10.9), pp(396, 22, 11.6),
      ...par(S(sP + 370), -1, side, 7, 30, merged),
    ],
  })));
  paIn.pa = paOut.pa = true;
  net.pa = { road: paRoad, lots, slots, bays: perLot, stallW: STALL_W, stallD: STALL_D, sExit: sP, paIn, paOut };

  // ---- C2 from both directions of the loop -------------------------------------------------------
  // Points along another ribbon between s0 and s1, the lateral offset easing off0 -> off1, at its height:
  // how a ramp peels off (0 -> beside) or blends into (beside -> 0) a link, like par() does on the loop.
  const along = (r, s0, s1, off0, off1, n = 5) => {
    const out = [], Q = {};
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1), e = t * t * (3 - 2 * t);
      r.pointAt(s0 + (s1 - s0) * t, lerp(off0, off1, e), Q);
      out.push(new THREE.Vector3(Q.x, Q.y, Q.z));
    }
    return out;
  };
  // which lateral side of r (at s) faces the point (x, z)
  const sideToward = (r, s, p) => { const a = r.pointAt(s, 6), b = r.pointAt(s, -6); return Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? 1 : -1; };
  // first s (scanning from `from` towards `to`) where r sits at loop offset <= offMax (the interior)
  const sAtLoopOff = (r, from, to, offMax) => {
    const st = from < to ? 4 : -4;
    for (let s = from; st > 0 ? s <= to : s >= to; s += st) { const Q = r.pointAt(s, 0); if (ring.projectGlobal(Q.x, Q.z).off <= offMax) return s; }
    return to;
  };
  const beside = 2 * RAMP_HW - OVERLAP; // ramp centre when it sits alongside a link, overlapping its edge by 1 m
  const rampOpts = (name, points) => link({ name, label: 'C2', kind: 'link', points });

  // A1  loop dir- (outside) -> C2 east: leaves before sA, hairpins under the loop and c2e's own exit,
  //     climbs inside and blends into c2e where it heads into the city
  const a1Join = sAtLoopOff(cPlus, 300, 900, -150);
  const a1Side = sideToward(cPlus, a1Join, rp(S(sA + 300), -240));
  const rampA1 = net.add(new Ribbon(rampOpts('c2eIn', [
    ...par(S(sA + 366), -1, side, 5, 30, null, merged),
    rp(S(sA + 200), 38, ringY(S(sA + 200)) - 1.6), rp(S(sA + 135), 48, 9.2), rp(S(sA + 90), 36, 6.6),
    rp(S(sA + 70), 8, 5.2), rp(S(sA + 76), -22, 5.2), rp(S(sA + 100), -50, 5.6), rp(S(sA + 145), -80, 7.0),
    rp(S(sA + 215), -104, 8.7), rp(S(sA + 290), -124, 10.4),
    ...along(cPlus, a1Join - 110, a1Join, a1Side * beside, 0, 5),
  ])));

  // A2  C2 west -> loop dir+ (inside): peels off c2w before it dives under the loop, stays up while
  //     c2w drops beneath it, and joins dir+ with an acceleration lane before the PA's exit
  // (it leaves while c2w is still on the city deck, and swings well clear before c2w starts to dive)
  const a2Div = sAtLoopOff(cMinus, cMinus.len - 1500, cMinus.len - 200, -262) - 170;
  // the side of c2w away from c2e (the two run side by side across the city)
  const awayFrom = (r, s, other) => { const P = r.pointAt(s, 0), Q = other.pointAt(other.projectGlobal(P.x, P.z).s, 0); return -sideToward(r, s, Q); };
  const a2Side = awayFrom(cMinus, a2Div + 60, cPlus);
  const Qa = cMinus.pointAt(a2Div + 190, a2Side * 24);
  const rampA2 = net.add(new Ribbon(rampOpts('c2wOut', [
    ...along(cMinus, a2Div, a2Div + 120, 0, a2Side * beside, 5),
    new THREE.Vector3(Qa.x, cMinus.pointAt(a2Div + 120, 0).y, Qa.z),
    rp(S(sA + 870), -178, 13.6), rp(S(sA + 905), -128, 12.8), rp(S(sA + 935), -76, 12.3), rp(S(sA + 960), -44, 12.1),
    rp(S(sA + 980), -26, 12.0),
    ...par(S(sA + 996), 1, -side, 4, 24, -merged),
  ])));

  // B1  loop dir+ (inside) -> C2 west: both inside the loop, no crossing; blends into c2w as it climbs away
  // (it meets c2w once c2w has climbed back onto the city deck, not on its dive under the loop)
  const b1Join = sAtLoopOff(cMinus, 600, 1600, -262) + 150;
  const b1Side = sideToward(cMinus, b1Join - 60, rp(S(sB - 900), -30));
  const Qb = cMinus.pointAt(b1Join - 190, b1Side * 24);
  const rampB1 = net.add(new Ribbon(rampOpts('c2wIn', [
    ...par(S(sB - 1100), 1, -side, 5, 30, null, -merged),
    rp(S(sB - 930), -36, ringY(S(sB - 930)) + 0.3), rp(S(sB - 880), -80, ringY(S(sB - 880)) + 1.2),
    new THREE.Vector3(Qb.x, cMinus.pointAt(b1Join - 120, 0).y, Qb.z),
    ...along(cMinus, b1Join - 120, b1Join, b1Side * beside, 0, 5),
  ])));

  // B2  U-turn dir+ -> dir- just after C2 east joins the loop (c2e -> dir- directly would have to cross
  //     c2w at its own height): peels off inside, hairpins under the loop, joins dir- outside
  const sU = S(sB + 150), yU = ringY(sU);
  const uy = d => ringY(S(sU + d));
  const rampB2 = net.add(new Ribbon(rampOpts('uTurnB', [
    ...par(sU, 1, -side, 5, 30, null, -merged),
    rp(S(sU + 170), -34, uy(170) - 0.8), rp(S(sU + 225), -55, uy(225) - 2.6), rp(S(sU + 275), -58, uy(275) - 4.6),
    rp(S(sU + 315), -40, uy(315) - 6.4), rp(S(sU + 335), -10, uy(335) - 7.0), rp(S(sU + 335), 20, uy(335) - 7.0),
    rp(S(sU + 315), 45, uy(315) - 6.4), rp(S(sU + 275), 58, uy(275) - 4.8), rp(S(sU + 225), 52, uy(225) - 2.8),
    rp(S(sU + 180), 36, uy(180) - 1.1),
    ...par(S(sU + 150), -1, side, 7, 30, merged),
  ])));
  rampB2.label = 'K1';
  for (const r of [rampA1, rampA2, rampB1, rampB2]) r.ramp = true;
  net.ramps = { a1: rampA1, a2: rampA2, b1: rampB1, b2: rampB2 };
  void yU;

  // median U-turn gaps
  const g1 = nearestS(1350, -985), g2 = nearestS(-1150, 1130);
  ring.medianGaps = [[g1 - 25, g1 + 25], [g2 - 25, g2 + 25]];

  // links for AI (li: the lane a car must be in to take a diverge / lands in after a merge; default the outer one)
  const laneOn = sgn => (sgn > 0 ? 0 : 1); // links' lanes are [+1.8, -1.8]
  net.links = {
    diverge: [
      { from: ring, dir: 1, s0: S(sA + 10), s1: S(sA + 110), to: cPlus, sideSign: -1 },
      { from: ring, dir: -1, s0: S(sB - 360), s1: S(sB - 460), to: cMinus, sideSign: 1 },
      { from: ring, dir: -1, s0: S(sA + 356), s1: S(sA + 256), to: rampA1, sideSign: 1 },
      { from: cMinus, dir: 1, s0: a2Div + 10, s1: a2Div + 100, to: rampA2, li: laneOn(a2Side) },
      { from: ring, dir: 1, s0: S(sB - 1090), s1: S(sB - 990), to: rampB1, sideSign: -1 },
      { from: ring, dir: 1, s0: S(sU + 10), s1: S(sU + 110), to: rampB2, sideSign: -1 },
    ],
    merge: [
      { from: cPlus, to: ring, dir: 1, sFrom: cPlus.len - 140 },
      { from: cMinus, to: ring, dir: -1, sFrom: cMinus.len - 140 },
      { from: rampA1, to: cPlus, dir: 1, sFrom: rampA1.len - 100, li: laneOn(a1Side) },
      { from: rampA2, to: ring, dir: 1, sFrom: rampA2.len - 90 },
      { from: rampB1, to: cMinus, dir: 1, sFrom: rampB1.len - 100, li: laneOn(b1Side) },
      { from: rampB2, to: ring, dir: -1, sFrom: rampB2.len - 140 },
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
  for (const r of net.ribbons) if (!r.closed && r.kind !== 'lot') smoothProfile(r, 10);
  drape(net);
  buildWalls(net);
  return net;
}
