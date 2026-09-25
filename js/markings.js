// Road markings painted where roads part and join: arrows in the exit lane over its last ~200 m, a
// zebra-striped V between the diverging (or merging) lane and the through lanes, and a thick broken
// line along the lane that becomes the exit (or that the ramp becomes). Geometry, not textures: every
// vertex is dropped onto the road surface at that spot (following curves and slopes; where decks overlap
// they share one surface), then lifted 2 cm. One merged mesh, drawn with the paint material's
// polygon offset so it wins over any deck beneath it.
import * as THREE from 'three';
import { clamp, lerp, wrap } from './util.js';
import { LANE_W } from './network.js';

const LIFT = 0.02;

export function buildMarkings(world, topo) {
  const net = world.net, res = [];
  const pos = [];
  // top of the road at (x, z) near height y (the gore infill between two decks is flush with both)
  const topY = (x, z, y) => {
    let best = -Infinity;
    for (const q of net.surfacesAt(x, z, y, 0.8, 0.02, res)) if (q.y > best) best = q.y;
    return (best > -Infinity ? best : y) + LIFT;
  };
  // wound to face up (front side) whatever order the corners come in
  const tri = (a, b, c) => {
    if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) pos.push(p.x, topY(p.x, p.z, p.y), p.z);
  };
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  const edgeLine = r => r.edge; // the solid line at the edge of the lanes
  const S = (r, s) => (r.closed ? wrap(s, r.len) : clamp(s, 0, r.len));

  // a point on road r, `a` metres along travel dir d from s0 and `b` metres to the drivers' right of offset `off`
  const onRoad = (r, d, s0, off, a, b) => {
    const P = r.pointAt(S(r, s0 + d * a), off + d * b);
    return { x: P.x, y: P.y, z: P.z };
  };

  // ---- arrows in the exit lane: straight, the head bent toward the exit
  const arrowAt = (r, d, s0, off, side) => {
    const P = (a, b) => onRoad(r, d, s0, off, a, b);
    const w = 0.15, bend = (25 * Math.PI) / 180, ua = Math.cos(bend), ub = Math.sin(bend) * side;
    // straight shaft, 4 m in 1 m pieces so it follows the road
    for (let a = 0; a < 4; a++) quad(P(a, -w), P(a + 1, -w), P(a + 1, w), P(a, w));
    // neck bent toward the exit, then the head; (-ub, ua) is normal to the bent direction
    const B0 = [3.9, 0], B1 = [4 + ua * 1.2, ub * 1.2];
    const nx = -ub * w, ny = ua * w;
    quad(P(B0[0] - nx, B0[1] - ny), P(B1[0] - nx, B1[1] - ny), P(B1[0] + nx, B1[1] + ny), P(B0[0] + nx, B0[1] + ny));
    const hx = -ub * 0.55, hy = ua * 0.55;
    tri(P(B1[0] - hx, B1[1] - hy), P(B1[0] + ua * 1.8, B1[1] + ub * 1.8), P(B1[0] + hx, B1[1] + hy));
  };

  // ---- the V between the ramp's lane edge and the host's edge line, stripes slanting across it
  const zebra = (e, isExit) => {
    const r = e.r, h = e.host, hs = e.sep.hostSide; // host on r's right when hs > 0
    const eL = edgeLine(h);
    // samples along r from the V's tip (lane edge meets the edge line) to its mouth at the separation
    const pts = [];
    let hintI = null;
    const stepS = isExit ? -0.5 : 0.5;
    for (let s = e.sep.s, n = 0; n < 1200; s += stepS, n++) {
      if (s < 0 || s > r.len) break;
      const E1 = r.pointAt(s, hs * r.edge);
      const pr = hintI === null ? h.projectGlobal(E1.x, E1.z) : h.projectLocal(E1.x, E1.z, hintI, 8);
      hintI = pr.i;
      const sg = Math.sign(pr.off) || 1;
      const E0 = h.pointAt(pr.s, sg * eL);
      const width = Math.abs(pr.off) - eL;
      if (width <= 0.05) break;
      pts.push({ E0: { x: E0.x, y: E0.y, z: E0.z }, E1: { x: E1.x, y: E1.y, z: E1.z }, width });
    }
    if (pts.length < 12) return null;
    pts.reverse(); // tip first
    // point at (fractional) sample k, fraction f of the way across the V
    const at = (k, f) => {
      k = clamp(k, 0, pts.length - 1);
      const i = Math.min(Math.floor(k), pts.length - 2), t = k - i, p = pts[i], q = pts[i + 1];
      const ax = lerp(p.E0.x, q.E0.x, t), ay = lerp(p.E0.y, q.E0.y, t), az = lerp(p.E0.z, q.E0.z, t);
      const bx = lerp(p.E1.x, q.E1.x, t), by = lerp(p.E1.y, q.E1.y, t), bz = lerp(p.E1.z, q.E1.z, t);
      return { x: lerp(ax, bx, f), y: lerp(ay, by, f), z: lerp(az, bz, f) };
    };
    // outline along the ramp's lane edge
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const f = w => Math.min(1, 0.2 / Math.max(0.2, w));
      quad(at(k, 1 - f(a.width)), at(k + 1, 1 - f(b.width)), at(k + 1, 1), at(k, 1));
    }
    // stripes: 0.5 m wide, one every 3 m, slanting 3 m forward across the V
    const N = pts.length;
    for (let k0 = 4; k0 + 7 < N; k0 += 6) {
      for (let j = 0; j < 4; j++) {
        const f0 = j / 4, f1 = (j + 1) / 4;
        const k = t => k0 + t * 6;
        quad(at(k(f0), f0), at(k(f0) + 1, f0), at(k(f1) + 1, f1), at(k(f1), f1));
      }
    }
    // where the V's tip is on the host, for the broken line
    const tipS = h.projectGlobal(pts[0].E1.x, pts[0].E1.z).s;
    return { tipS };
  };

  // ---- thick broken line (0.45 m) between the exit/entry lane and the next one
  const broken = (h, d, from, to, off) => {
    const len = h.closed ? wrap((to - from) * d, h.len) : (to - from) * d;
    if (!(len > 0) || len > 600) return;
    for (let a = 0; a + 5 <= len; a += 10) {
      for (let k = 0; k < 5; k++) quad(onRoad(h, d, from, off, a + k, -0.225), onRoad(h, d, from, off, a + k + 1, -0.225), onRoad(h, d, from, off, a + k + 1, 0.225), onRoad(h, d, from, off, a + k, 0.225));
    }
  };

  const laneOn = (h, d, side) => h.lanes[d].reduce((m, o) => (o * d * side > m * d * side ? o : m));
  for (const e of topo.exits) {
    const h = e.host, d = e.dir;
    if (!h.lanes || !h.lanes[d]) continue;
    const z = zebra(e, true);
    // the parking area's aisle gets the V only
    if (h.kind === 'pa') continue;
    const lane = laneOn(h, d, e.side);
    // arrows over the last ~200 m before the lane starts to peel off
    for (const t of [185, 115, 45]) arrowAt(h, d, e.sAt - d * t, lane, e.side);
    const sg = -Math.sign(lane) || 1;
    const boundary = h.kind === 'ring' ? lane + sg * LANE_W / 2 : 0;
    if (z) broken(h, d, e.sAt - d * 150, z.tipS, boundary);
  }
  for (const e of topo.merges) {
    const h = e.host, d = e.dir;
    if (!h.lanes || !h.lanes[d]) continue;
    const z = zebra(e, false);
    if (h.kind === 'pa') continue;
    const lane = laneOn(h, d, e.side);
    const sg = -Math.sign(lane) || 1;
    const boundary = h.kind === 'ring' ? lane + sg * LANE_W / 2 : 0;
    if (z) broken(h, d, z.tipS, e.sAt, boundary);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const mesh = new THREE.Mesh(g, world.mats.paint);
  mesh.renderOrder = 1;
  world.root.add(mesh);
  world.markings = { mesh, tris: pos.length / 9 };
  return mesh;
}
