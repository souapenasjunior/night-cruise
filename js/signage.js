// Road signs computed from the network itself, kept to what a driver needs: every exit from the loop
// (to the PA) gets advance boards at its real distance (1 km / 500 m), an EXIT board over the
// exit lane and a sign on the gore showing both ways; inside the PA a gore sign shows the way back to
// the loop; region names stand by the roadside. Green = directions, blue = services (PA). Boards on one
// road (and direction) keep >= 250 m apart. All faces share canvas atlases; all steel is one mesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wrap, makeCanvas } from './util.js';
import { RING_X, PARAPET_W } from './network.js';
import { t, num, zoneName } from './i18n.js';

export const SIGN_GAP = 250;
// gore sign: each half of the plate is this wide (m); the V must be this wide for the post
const GORE_HALF = 1.75, GORE_GAP = 2 * GORE_HALF + 0.3;
const GREEN = '#13704a', BLUE = '#1d4b98', WHITE = '#f2f5f1';
const JP = '"Yu Gothic UI", "Yu Gothic", "Meiryo", "Hiragino Sans", "Noto Sans JP", sans-serif';
const EN = '"IBM Plex Sans", "Segoe UI", Arial, sans-serif';
// destinations: the Japanese line stays, the line under it (`en`) follows the language
const K1 = d => (d > 0 ? { shield: 'K1', jp: '内回り', en: t('sign.inner') } : { shield: 'K1', jp: '外回り', en: t('sign.outer') });
const PA_DEST = () => ({ shield: 'P', jp: '西PA', en: t('sign.pa'), blue: true });

// ------------------------------------------------------------------ topology
// Where each ribbon starts and ends on another one (its host), in which direction of the host, and
// where the two decks part: `sep` (edges 0.5 m apart) and `gore` (1.5 m apart, the nose of the V).
export function roadTopology(net) {
  const find = (r, P) => {
    for (const q of net.ribbons) {
      if (q === r || q.kind === 'lot') continue;
      const pr = q.projectGlobal(P.x, P.z);
      if (Math.abs(pr.off) > q.hw + 0.1 || Math.abs(pr.y - P.y) > 1) continue;
      if (!q.closed && ((pr.t < 0 && pr.i === 0) || (pr.t > 1 && pr.i >= q.n - 2))) continue;
      return { q, pr };
    }
    return null;
  };
  const part = (r, q, fromEnd) => {
    let hint = null, sep = null, gore = null;
    for (let k = 0; k * 2 <= r.len; k++) {
      const s = fromEnd ? r.len - k * 2 : k * 2;
      const P = r.pointAt(s, 0);
      const pr = hint === null ? q.projectGlobal(P.x, P.z) : q.projectLocal(P.x, P.z, hint, 8);
      hint = pr.i;
      const gap = Math.abs(pr.off) - q.hw - r.hw, dy = Math.abs(pr.y - P.y);
      if (!sep && (gap >= 0.5 || dy > 2)) {
        // which side of r the host lies on (+1: r's right)
        const H = q.pointAt(pr.s, 0);
        const rel = (H.x - P.x) * -P.tz + (H.z - P.z) * P.tx;
        sep = { s, sHost: pr.s, side: Math.sign(pr.off), hostSide: Math.sign(rel) };
      }
      if (sep && !gore && gap >= 1.5 && dy < 0.4) gore = { s, sHost: pr.s };
      if (sep && (gore || gap > 3 || dy > 0.4 || Math.abs(s - sep.s) > 300)) break;
    }
    return { sep, gore };
  };
  const exits = [], merges = [], att = new Map();
  for (const r of net.ribbons) {
    if (r.closed || r.kind === 'lot') continue;
    const a = {};
    for (const end of [0, 1]) {
      const P = r.pointAt(end ? r.len : 0, 0);
      const f = find(r, P);
      if (!f) continue;
      const d = Math.sign(P.tx * f.pr.tx + P.tz * f.pr.tz) || 1;
      const { sep, gore } = part(r, f.q, end === 1);
      if (!sep) continue;
      // side: where r lies as seen by the host's drivers (-1 left, +1 right)
      const e = { r, host: f.q, dir: d, sAt: f.pr.s, sep, gore, side: sep.side * d };
      (end ? merges : exits).push(e);
      a[end ? 'end' : 'start'] = e;
    }
    att.set(r, a);
  }
  return { exits, merges, att };
}

// what a ribbon leads to
function destOf(topo, r) {
  const a = topo.att.get(r) || {};
  if (r.kind === 'pa' && a.start && a.start.host.kind === 'ring') return PA_DEST();
  const e = a.end;
  if (!e) return null;
  if (e.host.kind === 'ring') {
    const k = K1(e.dir);
    // leaving one carriageway of the loop for the other
    if (a.start && a.start.host.kind === 'ring' && a.start.dir !== e.dir) return { ...k, jp: 'Uターン', en: t('sign.uturn') + ' · ' + k.en };
    return k;
  }
  if (e.host.kind === 'pa') return PA_DEST();
  return null;
}
// what staying on a road leads to
function throughOf(topo, road, d) {
  if (road.kind === 'ring') return K1(d);
  const e = (topo.att.get(road) || {}).end;
  if (!e) return null;
  return e.host.kind === 'ring' ? K1(e.dir) : e.host.kind === 'pa' ? PA_DEST() : null;
}

export function fmtDist(m) {
  if (m < 950) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  const k = Math.round(m / 100) / 10;
  return `${Number.isInteger(k) ? k : num(k)} km`;
}

// ------------------------------------------------------------------ drawing
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
// arrow centred on (cx, cy), `deg` clockwise from straight up
function arrow(g, cx, cy, size, deg, color = WHITE) {
  g.save();
  g.translate(cx, cy);
  g.rotate((deg * Math.PI) / 180);
  g.fillStyle = color;
  const sw = size * 0.12, hw = size * 0.36, hl = size * 0.42, top = -size / 2, bot = size / 2;
  g.beginPath();
  g.moveTo(0, top); g.lineTo(hw, top + hl); g.lineTo(sw, top + hl); g.lineTo(sw, bot);
  g.lineTo(-sw, bot); g.lineTo(-sw, top + hl); g.lineTo(-hw, top + hl);
  g.closePath();
  g.fill();
  g.restore();
}
// largest font (from px down) at which text fits maxW; it always fits, however small
function fit(g, text, weight, px, family, maxW) {
  let p = px;
  do { g.font = `${weight} ${Math.round(p * 10) / 10}px ${family}`; p *= 0.92; } while (g.measureText(text).width > maxW && p > 2);
}
// like fit, but a text that would shrink below 80% goes on two lines (split at the space nearest the
// middle); returns the lines, the font is set for them
function fitWrap(g, text, weight, px, family, maxW) {
  fit(g, text, weight, px, family, maxW);
  const size = parseFloat(/([\d.]+)px/.exec(g.font)[1]);
  if (size >= px * 0.8 || text.indexOf(' ') < 0) return [text];
  let cut = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (cut < 0 || Math.abs(i - text.length / 2) < Math.abs(cut - text.length / 2))) cut = i;
  const lines = [text.slice(0, cut), text.slice(cut + 1)];
  const longest = lines.reduce((a, b) => (g.measureText(a).width >= g.measureText(b).width ? a : b));
  fit(g, longest, weight, px * 0.85, family, maxW);
  return lines;
}
// route shield; returns its width
function shield(g, x, cy, size, dest, bg) {
  const w = dest.shield === 'P' ? size : size * 1.35;
  g.fillStyle = WHITE;
  rrect(g, x, cy - size / 2, w, size, size * 0.14);
  g.fill();
  g.fillStyle = dest.shield === 'P' ? BLUE : bg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fit(g, dest.shield, 800, size * 0.72, EN, w * 0.86);
  g.fillText(dest.shield, x + w / 2, cy + size * 0.04);
  return w;
}
function plate(g, x, y, w, h, bg) {
  g.fillStyle = bg;
  rrect(g, x, y, w, h, Math.min(w, h) * 0.06);
  g.fill();
  g.strokeStyle = WHITE;
  g.lineWidth = Math.max(2, h * 0.025);
  const i = Math.max(3, h * 0.035);
  rrect(g, x + i, y + i, w - 2 * i, h - 2 * i, Math.min(w, h) * 0.05);
  g.stroke();
}
// one destination line: [arrow] shield  名前 / English  ....  distance [arrow]
function destRow(g, x, y, w, h, { dest, dist, arrowDeg = null, arrowSide = -1, bg }) {
  const pad = h * 0.14;
  let x0 = x + pad, x1 = x + w - pad;
  if (arrowDeg !== null) {
    const a = h * 0.78;
    if (arrowSide < 0) { arrow(g, x0 + a / 2, y + h / 2, a, arrowDeg); x0 += a + pad * 0.6; } else { arrow(g, x1 - a / 2, y + h / 2, a, arrowDeg); x1 -= a + pad * 0.6; }
  }
  if (dest.shield) x0 += shield(g, x0, y + h / 2, h * 0.5, dest, bg) + pad * 0.8;
  g.fillStyle = WHITE;
  g.textBaseline = 'middle';
  // the distance shares the Japanese line; the line under it (the player's language) gets the full width
  const xEnd = x1;
  if (dist) {
    g.textAlign = 'right';
    fit(g, dist, 700, h * 0.4, EN, w * 0.3);
    const dw = g.measureText(dist).width;
    g.fillText(dist, x1, y + h * 0.36);
    x1 -= dw + pad;
  }
  g.textAlign = 'left';
  fit(g, dest.jp, 700, h * 0.42, JP, x1 - x0);
  g.fillText(dest.jp, x0, y + h * 0.36);
  fit(g, dest.en, 600, h * 0.2, EN, xEnd - x0);
  g.fillText(dest.en, x0, y + h * 0.76);
}
// ------------------------------------------------------------------ atlas
class Atlas {
  constructor() { this.pages = []; this.size = 2048; this.tiles = []; }
  // reserve a tile; it is packed and drawn in finish()
  add(wPx, hPx, draw) {
    const t = { w: Math.ceil(wPx), h: Math.ceil(hPx), draw };
    this.tiles.push(t);
    return t;
  }
  // shelf-pack the tiles tallest first, draw them, crop the last page to the rows it uses, then the UVs
  // (canvas textures are flipped: v = 1 at the top)
  finish() {
    const S = this.size, pad = 4;
    let p = null;
    for (const t of [...this.tiles].sort((a, b) => b.h - a.h || b.w - a.w)) {
      if (!p) p = this._page();
      if (p.x + t.w > S) { p.x = 0; p.y += p.rowH + pad; p.rowH = 0; }
      if (p.y + t.h > S) p = this._page();
      Object.assign(t, { page: this.pages.length - 1, x: p.x, y: p.y });
      p.x += t.w + pad; p.rowH = Math.max(p.rowH, t.h);
      p.g.save();
      p.g.beginPath(); p.g.rect(t.x, t.y, t.w, t.h); p.g.clip();
      t.draw(p.g, t.x, t.y, t.w, t.h);
      p.g.restore();
    }
    if (p) {
      const used = Math.ceil((p.y + p.rowH + pad) / 64) * 64;
      if (used < S) {
        const c = makeCanvas(S, used);
        c.getContext('2d').drawImage(p.c, 0, 0);
        p.c = c;
      }
    }
    for (const t of this.tiles) {
      const W = this.pages[t.page].c.width, H = this.pages[t.page].c.height;
      Object.assign(t, { u0: t.x / W, u1: (t.x + t.w) / W, v0: 1 - (t.y + t.h) / H, v1: 1 - t.y / H });
    }
  }
  _page() {
    const c = makeCanvas(this.size, this.size), g = c.getContext('2d');
    const p = { c, g, x: 0, y: 0, rowH: 0 };
    this.pages.push(p);
    return p;
  }
}

// ------------------------------------------------------------------ build
export function buildSignage(world) {
  const net = world.net, ring = net.ring, L = ring.len;
  const topo = roadTopology(net);
  const res = [];
  const poles = world.poles || [];
  const nearPole = (x, z, rad) => poles.some(p => Math.abs(p.x - x) < rad && Math.abs(p.z - z) < rad && Math.hypot(p.x - x, p.z - z) < rad);
  const clampI = (r, i) => (r.closed ? ((i % r.n) + r.n) % r.n : Math.max(0, Math.min(r.n - 1, i)));
  const edgeClosed = (r, i, sides, k = 3) => {
    for (let j = -k; j <= k; j++) { const m = clampI(r, i + j); for (const sg of sides) if ((sg < 0 ? r.openL : r.openR)[m]) return false; }
    return true;
  };
  const others = (r, x, z, y, tol, extra) => net.surfacesAt(x, z, y, tol, extra, res).some(q => q.r !== r);
  const tunnel = (r, y) => r.kind === 'ring' && y < 4.2;

  // overhead gantry across the whole deck at s. Legs stand on the edges that have a parapet (and on the
  // loop's median wall); where a ramp peels off one edge the beam overhangs it as a cantilever.
  // Returns the leg offsets, or null.
  const gantryLegs = (r, s) => {
    const P = r.pointAt(s, 0);
    if (tunnel(r, P.y)) return null;
    if (r.median && r.medianGaps.some(([g0, g1]) => s > g0 - 20 && s < g1 + 20)) return null;
    const ext = r.hw - 0.3;
    const legs = r.median ? [0] : [];
    for (const sg of [-1, 1]) if (edgeClosed(r, P.i, [sg])) legs.push(sg * ext);
    if (legs.length < (r.median ? 2 : 1)) return null;
    for (let o = -ext; o <= ext + 0.01; o += ext / 5) {
      const Q = r.pointAt(s, o);
      // nothing within 12 m above the deck (a crossing road); a ramp lying on the deck itself is fine
      if (net.surfacesAt(Q.x, Q.z, Q.y + 6.5, 5.5, 0.3, res).some(q => q.r !== r && q.y > Q.y + 1)) return null;
    }
    for (const o of legs) {
      const Q = r.pointAt(s, o);
      // no other deck within 1.2 m of a leg, no lamp pole on it
      if (others(r, Q.x, Q.z, Q.y + 5.75, 6.25, 1.2) || nearPole(Q.x, Q.z, 1.6)) return null;
    }
    return legs;
  };
  // post on the parapet at the drivers' left, the plate reaching out past the edge
  const sideOk = (r, s, d) => {
    const P = r.pointAt(s, 0);
    if (tunnel(r, P.y)) return false;
    const u = -1, sg = u * d; // offset sign of the left edge for drivers going d
    if (!edgeClosed(r, P.i, [sg], 4)) return false;
    // (the plate reaches 3.2 m past the edge: nothing may lie there)
    for (const o of [r.hw - 0.2, r.hw + 1.6, r.hw + 3.4]) {
      const Q = r.pointAt(s, sg * o);
      if (others(r, Q.x, Q.z, Q.y + 1.5, 3.5, 0.3)) return false;
    }
    const Q = r.pointAt(s, sg * (r.hw - 0.2));
    return !nearPole(Q.x, Q.z, 2.5);
  };

  // ---- wants
  const roadKey = (r, d) => r.id + ':' + d;
  const placed = new Map(); // roadKey -> [{s, kind}]
  const sites = []; // ring gantry sites {s, faces: {1, -1}}
  const items = []; // everything built later
  const dist = (r, a, b) => { if (!r.closed) return Math.abs(a - b); const x = Math.abs(wrap(a - b, r.len)); return Math.min(x, r.len - x); };
  const ahead = (r, d, from, to) => (r.closed ? wrap((to - from) * d, r.len) : (to - from) * d);
  // 250 m between boards of a kind (overhead / roadside); a small roadside name plate and an overhead
  // board never overlap in view, so between the two 150 m is enough
  const SIDE = new Set(['region']);
  const spaced = (r, d, s, kind) => !(placed.get(roadKey(r, d)) || []).some(b => dist(r, b.s, s) < (SIDE.has(kind) === SIDE.has(b.kind) ? SIGN_GAP : 150));
  const wants = [];
  // only exits that lead somewhere get boards (the PA's own roads are two-way: a branch driven
  // backwards is no destination)
  const exitsOn = (r, d) => topo.exits.filter(e => e.host === r && e.dir === d && destOf(topo, e.r));

  for (const e of topo.exits) {
    const r = e.host, d = e.dir;
    if (!destOf(topo, e.r) || (r.kind !== 'ring' && r.kind !== 'pa')) continue;
    if (e.gore) wants.push({ prio: 0, kind: 'gore', r, d, e });
    if (r.kind !== 'ring') continue;
    // before the taper starts (from there the edge is open), over the lane that becomes the exit
    wants.push({ prio: 0, kind: 'exit', r, d, e, t: 10, lo: 2, hi: 70, type: 'gantry' });
    wants.push({ prio: 2, kind: 'adv', r, d, e, t: 500, lo: 400, hi: 650, type: 'gantry' });
    wants.push({ prio: 3, kind: 'adv', r, d, e, t: 1000, lo: 820, hi: 1300, type: 'gantry' });
  }
  // region names where each stretch begins: between the previous zone and this one, nearer the boundary
  const ringZones = net.zones.filter(z => z.r === ring);
  for (const z of ringZones) for (const d of [1, -1]) {
    const gap = Math.min(...ringZones.filter(o => o !== z).map(o => ahead(ring, d, o.s, z.s)));
    wants.push({ prio: 6, kind: 'region', r: ring, d, z, t: gap * 0.4, lo: 0, hi: gap * 0.5, type: 'side', ref: z.s });
  }
  wants.sort((a, b) => a.prio - b.prio || b.d - a.d);

  const put = (w, s) => {
    const k = roadKey(w.r, w.d);
    if (!placed.has(k)) placed.set(k, []);
    placed.get(k).push({ s, kind: w.kind, e: w.e });
  };
  for (const w of wants) {
    const r = w.r, d = w.d;
    if (w.kind === 'gore') { items.push({ kind: 'gore', r, d, e: w.e }); continue; }
    const ref = w.ref !== undefined ? w.ref : w.e.sAt;
    // candidate positions: t metres before ref (travel distance), nearest to the ideal first;
    // on the loop, an existing gantry of the other direction within the window comes first
    // an EXIT board of an earlier exit in this window already announces this one on its through panel
    if (w.kind === 'adv' && (placed.get(roadKey(r, d)) || []).some(b => b.kind === 'exit' && b.e !== w.e && (x => x >= w.lo && x <= w.hi)(ahead(r, d, b.s, ref)))) continue;
    const cands = [];
    for (let t = w.lo; t <= w.hi; t += 5) cands.push({ t, pref: Math.abs(t - w.t) });
    if (r.kind === 'ring' && w.type === 'gantry') {
      for (const site of sites) {
        if (site.faces[d]) continue;
        const t = ahead(r, d, site.s, ref);
        if (t >= w.lo && t <= w.hi) cands.push({ t, pref: -1000 + Math.abs(t - w.t), site });
      }
    }
    cands.sort((a, b) => a.pref - b.pref);
    for (const c of cands) {
      let s = ref - d * c.t;
      if (r.closed) s = wrap(s, L); else if (s < 20 || s > r.len - 20) continue;
      if (!spaced(r, d, s, w.kind)) continue;
      const item = { kind: w.kind, r, d, s, e: w.e, z: w.z };
      if (c.site) { c.site.faces[d] = item; put(w, s); break; }
      const legs = w.type === 'gantry' ? gantryLegs(r, s) : null;
      if (w.type === 'gantry' ? !legs : !sideOk(r, s, d)) continue;
      if (r.kind === 'ring' && w.type === 'gantry') sites.push({ s, legs, faces: { [d]: item } });
      else items.push({ ...item, type: w.type, legs });
      put(w, s);
      break;
    }
  }
  // ---- inside the PA (its access road is two-way): the way out at each end, NO ENTRY into the entry roads
  const paSigns = [];
  for (const w of (net.pa && net.pa.signs) || []) {
    // nearest spot (within 12 m) where the steel fits
    for (let k = 0; k <= 12; k++) {
      const s = w.s + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2;
      if (s < 5 || s > w.r.len - 5) continue;
      if (w.kind === 'paexit') {
        // legs on the parapeted edge(s); the PA's own roads lying on the deck at its level are fine
        const P = w.r.pointAt(s, 0), ext = w.r.hw - 0.3;
        const legs = [-1, 1].filter(sg => edgeClosed(w.r, P.i, [sg])).map(sg => sg * ext);
        if (!legs.length || legs.some(o => {
          const Q = w.r.pointAt(s, o);
          return nearPole(Q.x, Q.z, 1.6) || net.surfacesAt(Q.x, Q.z, Q.y + 5.75, 6.25, 1.2, res).some(q => q.r !== w.r && Math.abs(q.y - Q.y) > 0.6);
        })) continue;
        const it = { kind: 'paexit', type: 'gantry', r: w.r, d: w.d, s, legs, dest: K1(w.dest), arrowDeg: w.arrow };
        items.push(it); paSigns.push(it);
      } else {
        if (!sideOk(w.r, s, w.d)) continue;
        const it = { kind: 'noentry', type: 'side', r: w.r, d: w.d, s };
        items.push(it); paSigns.push(it);
      }
      break;
    }
  }

  // ---- contents
  const zonesAhead = (d, s, n) => net.zones.filter(z => z.r === ring).map(z => ({ z, t: ahead(ring, d, s, z.s) })).filter(o => o.t > 300).sort((a, b) => a.t - b.t).slice(0, n);
  const exitsAhead = (r, d, s, n, maxT = 3200) => exitsOn(r, d).map(e => ({ e, t: ahead(r, d, s, e.sAt) })).filter(o => o.t > 0 && o.t <= maxT).sort((a, b) => a.t - b.t).slice(0, n);
  const bgOf = dest => (dest && dest.blue ? BLUE : GREEN);
  const arrowFor = side => (side < 0 ? -45 : 45);
  const atlas = new Atlas();
  // px per metre, by texture quality (all boards fit one or two 2048 atlases)
  const tq = { low: 0.6, medium: 0.8, high: 1 }[world.q && world.q.textures] || 1;
  const HI = Math.round(46 * tq), SMALL = Math.round(72 * tq);
  const panels = []; // {r, d, s, u0, u1, y0, h, tile, bright}
  const steel = [];
  const addPanel = (r, d, s, u0, u1, y0, h, ppm, draw, bright = 0.85, forward = 0) => {
    const w = u1 - u0;
    const tile = atlas.add(w * ppm, h * ppm, draw);
    panels.push({ r, d, s, u0, u1, y0, h, tile, bright, forward });
  };

  const faceBoards = (it, span) => {
    const { r, d, s } = it;
    // driver-lateral range of the deck this face covers (u: + = drivers' right)
    // (over the lanes, from 0.6 m past the edge line to the yellow line; links: 1.4 m past each edge line)
    const u0 = r.kind === 'ring' ? -(r.edge + 0.6) : -(r.edge + 1.4), u1 = r.kind === 'ring' ? -(RING_X.yellow - 0.25) : r.edge + 1.4;
    const mid = (u0 + u1) / 2;
    const Y = 6.5;
    if (it.kind === 'exit') {
      const e = it.e, dest = destOf(topo, e.r), side = e.side;
      const exW = r.kind === 'ring' ? 5.8 : 4.6;
      const eu0 = side < 0 ? u0 : u1 - exW, eu1 = eu0 + exW;
      addPanel(r, d, s, eu0, eu1, Y, 3.2, HI, (g, x, y, w, h) => {
        const bg = bgOf(dest);
        plate(g, x, y, w, h, bg);
        const pad = h * 0.08, a = h * 0.44, ax = side < 0 ? x + pad * 1.5 + a / 2 : x + w - pad * 1.5 - a / 2;
        arrow(g, ax, y + h * 0.64, a, 180);
        const tx0 = side < 0 ? x + pad * 2.5 + a : x + pad * 1.5, tx1 = side < 0 ? x + w - pad * 1.5 : x + w - pad * 2.5 - a;
        // 出口 EXIT tab
        g.fillStyle = WHITE; rrect(g, x + pad * 1.5, y + pad * 1.2, w - pad * 3, h * 0.24, h * 0.04); g.fill();
        g.fillStyle = bg; g.textAlign = 'center'; g.textBaseline = 'middle';
        const exitTxt = '出口  ' + t('sign.exit');
        fit(g, exitTxt, 800, h * 0.19, `${JP}`, w - pad * 5);
        g.fillText(exitTxt, x + w / 2, y + pad * 1.2 + h * 0.125);
        const sw = shield(g, tx0, y + h * 0.54, h * 0.24, dest, bg);
        g.fillStyle = WHITE; g.textAlign = 'left';
        fit(g, dest.jp, 700, h * 0.27, JP, tx1 - tx0 - sw - pad * 0.6);
        g.fillText(dest.jp, tx0 + sw + pad * 0.6, y + h * 0.55);
        fit(g, dest.en, 600, h * 0.14, EN, tx1 - tx0);
        g.fillText(dest.en, tx0, y + h * 0.8);
      });
      // the lanes that carry on
      const tu0 = side < 0 ? eu1 + 0.4 : u0, tu1 = side < 0 ? u1 : eu0 - 0.4;
      // second line: the next exit if one comes soon, else the next region
      const thr = throughOf(topo, r, d);
      const nx = exitsAhead(r, d, s, 2, 2200).find(o => o.e !== e);
      const nz = r.kind === 'ring' ? zonesAhead(d, s, 1)[0] : null;
      addPanel(r, d, s, tu0, tu1, Y, 3.2, HI, (g, x, y, w, h) => {
        plate(g, x, y, w, h, GREEN);
        destRow(g, x, y + h * 0.06, w, h * 0.5, { dest: thr, arrowDeg: 0, arrowSide: 1, bg: GREEN });
        if (nx) {
          const dest = destOf(topo, nx.e.r), bg = bgOf(dest);
          g.fillStyle = bg; rrect(g, x + h * 0.08, y + h * 0.55, w - h * 0.16, h * 0.38, h * 0.03); g.fill();
          destRow(g, x + h * 0.08, y + h * 0.55, w - h * 0.16, h * 0.38, { dest, dist: fmtDist(nx.t), arrowDeg: arrowFor(nx.e.side), arrowSide: nx.e.side, bg });
        } else if (nz) destRow(g, x + h * 0.1, y + h * 0.52, w - h * 0.1, h * 0.42, { dest: { shield: '', jp: nz.z.jp, en: zoneName(nz.z.name) }, dist: fmtDist(nz.t), bg: GREEN });
      });
    } else if (it.kind === 'paexit') {
      const w = Math.min(7.5, u1 - u0);
      addPanel(r, d, s, mid - w / 2, mid + w / 2, Y, 3.0, HI, (g, x, y, W, H) => {
        plate(g, x, y, W, H, GREEN);
        g.fillStyle = WHITE; rrect(g, x + H * 0.08, y + H * 0.08, W - H * 0.16, H * 0.26, H * 0.04); g.fill();
        g.fillStyle = GREEN; g.textAlign = 'center'; g.textBaseline = 'middle';
        const exitTxt = '出口  ' + t('sign.exit');
        fit(g, exitTxt, 800, H * 0.19, JP, W - H * 0.4);
        g.fillText(exitTxt, x + W / 2, y + H * 0.215);
        destRow(g, x, y + H * 0.38, W, H * 0.58, { dest: it.dest, arrowDeg: it.arrowDeg, arrowSide: 1, bg: GREEN });
      });
    } else if (it.kind === 'adv') {
      const list = exitsAhead(r, d, s, 2);
      if (!list.length) return;
      const w = Math.min(9, u1 - u0), h = list.length > 1 ? 3.4 : 2.4;
      addPanel(r, d, s, mid - w / 2, mid + w / 2, Y, h, HI, (g, x, y, W, H) => {
        const rh = (H - H * 0.08) / list.length;
        g.fillStyle = WHITE; g.fillRect(x, y, W, H);
        list.forEach((o, k) => {
          const dest = destOf(topo, o.e.r), bg = bgOf(dest);
          const yy = y + H * 0.04 + k * rh;
          g.fillStyle = bg; rrect(g, x + H * 0.03, yy, W - H * 0.06, rh - H * 0.02, H * 0.03); g.fill();
          destRow(g, x + H * 0.03, yy, W - H * 0.06, rh - H * 0.02, { dest, dist: fmtDist(o.t), arrowDeg: arrowFor(o.e.side), arrowSide: o.e.side, bg });
        });
      });
    }
    void span;
  };

  // ---- steel + panels
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const box = (x, y, z, sx, sy, sz, yaw) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    eu.set(0, yaw, 0); q.setFromEuler(eu);
    m4.compose(v.set(x, y, z), q, one);
    g.applyMatrix4(m4);
    steel.push(g.toNonIndexed());
  };
  const gantrySteel = (r, s, legs) => {
    const P = r.pointAt(s, 0), yaw = Math.atan2(P.tx, P.tz), ext = r.hw - 0.3;
    for (const o of legs) {
      // a cantilever's leg is heavier; edge legs stand on the parapet, their inner face flush with it
      const t = legs.length < (r.median ? 3 : 2) ? 0.55 : 0.35;
      const Q = r.pointAt(s, o === 0 ? 0 : Math.sign(o) * (r.hw - PARAPET_W + t / 2));
      box(Q.x, Q.y + 3.9, Q.z, t, 7.8, t, yaw);
    }
    box(P.x, P.y + 7.7, P.z, ext * 2, 0.35, 0.35, yaw);
    box(P.x, P.y + 6.9, P.z, ext * 2, 0.2, 0.2, yaw);
  };
  for (const site of sites) {
    gantrySteel(ring, site.s, site.legs);
    for (const d of [1, -1]) if (site.faces[d]) faceBoards(site.faces[d]);
  }
  for (const it of items) {
    if (it.type === 'gantry') { gantrySteel(it.r, it.s, it.legs); faceBoards(it); continue; }
    const { r, d, s } = it;
    if (it.type === 'side') {
      // post on the parapet, plate over the edge
      const sg = -d, P = r.pointAt(s, sg * (r.hw - 0.2)), yaw = Math.atan2(P.tx, P.tz);
      const postH = it.kind === 'noentry' ? 4.9 : 3.6;
      box(P.x, P.y + postH / 2, P.z, 0.16, postH, 0.16, yaw);
      if (it.kind === 'noentry') {
        // red disc with a white bar over a white plate: 進入禁止 + NO ENTRY, 出口ではありません + NOT AN EXIT
        const w = 2.2, h = 3.4, uc = -(r.hw - 0.2 + w / 2);
        addPanel(r, d, s, uc - w / 2, uc + w / 2, 1.5, h, SMALL, (g, x, y, W, H) => {
          g.fillStyle = '#22262d'; rrect(g, x, y, W, H, W * 0.05); g.fill();
          const R = W * 0.34, cx = x + W / 2, cy = y + W * 0.42;
          g.fillStyle = WHITE; g.beginPath(); g.arc(cx, cy, R * 1.07, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#c8202a'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
          g.fillStyle = WHITE; g.fillRect(cx - R * 0.72, cy - R * 0.16, R * 1.44, R * 0.32);
          const m = W * 0.05, py = y + W * 0.84, ph = H - (py - y) - m, pw = W - 2 * m, tw = pw * 0.9;
          g.fillStyle = WHITE; rrect(g, x + m, py, pw, ph, W * 0.04); g.fill();
          g.fillStyle = '#c8202a'; g.textAlign = 'center'; g.textBaseline = 'middle';
          const noEntry = t('sign.noEntry'), notExit = t('sign.notExit');
          fit(g, '進入禁止', 800, ph * 0.26, JP, tw); g.fillText('進入禁止', cx, py + ph * 0.19);
          fit(g, noEntry, 800, ph * 0.2, EN, tw); g.fillText(noEntry, cx, py + ph * 0.43);
          g.fillStyle = '#22262d';
          fit(g, '出口ではありません', 700, ph * 0.13, JP, tw); g.fillText('出口ではありません', cx, py + ph * 0.65);
          fit(g, notExit, 700, ph * 0.15, EN, tw); g.fillText(notExit, cx, py + ph * 0.84);
        }, 0.9, 0.12);
        continue;
      }
      const z = it.z;
      const w = 3.4, h = 1.3;
      // u (drivers' right) of the plate: from the post on the parapet outward, clear of the shoulder
      const uc = -(r.hw - 0.2 + w / 2);
      addPanel(r, d, s, uc - w / 2, uc + w / 2, 2.3, h, SMALL, (g, x, y, W, H) => {
        plate(g, x, y, W, H, GREEN);
        g.fillStyle = WHITE; g.textBaseline = 'middle';
        g.textAlign = 'center';
        fit(g, z.jp, 700, H * 0.44, JP, W * 0.9); g.fillText(z.jp, x + W / 2, y + H * 0.38);
        const zn = zoneName(z.name).toUpperCase();
        fit(g, zn, 600, H * 0.2, EN, W * 0.9); g.fillText(zn, x + W / 2, y + H * 0.76);
      }, 0.85, 0.12);
    } else if (it.kind === 'gore') {
      const e = it.e, host = e.host;
      // the post stands in the V between the two decks, where the V is wide enough for the whole plate
      // (2.6 m) to clear both parapets: searched along the ramp from the nose, across the host's
      // cross-section (the ramp crosses it at an angle: measured along any other line the post would
      // land on a deck)
      const away = Math.sign(e.gore.s - e.sep.s) || 1;
      let hs = 0, P = null, H = null, sg = 1, gap = 0;
      for (let k = 0; k <= 50 && gap < GORE_GAP; k++) {
        const s = e.gore.s + away * k * 2;
        if (s < 0 || s > e.r.len) break;
        P = e.r.pointAt(s, 0);
        hs = host.projectGlobal(P.x, P.z).s;
        H = host.pointAt(hs, 0);
        sg = Math.sign((P.x - H.x) * -H.tz + (P.z - H.z) * H.tx); // host side of the ramp
        gap = 0;
        // (projected near s: the same road may pass close by elsewhere, at another level)
        for (let t = 0.05; t < 8; t += 0.05) {
          const Q = host.pointAt(hs, sg * (host.hw + t));
          if (Math.abs(e.r.projectLocal(Q.x, Q.z, Math.floor(s / e.r.ds), 12).off) <= e.r.hw) { gap = t; break; }
        }
      }
      if (gap < GORE_GAP) continue;
      const E1 = host.pointAt(hs, sg * host.hw);
      const G = host.pointAt(hs, sg * (host.hw + gap / 2));
      const gx = G.x, gz = G.z, gy = Math.min(E1.y, P.y);
      // nothing overhead, no pole in the way
      if (net.surfacesAt(gx, gz, gy + 3.5, 3, 0.2, res).some(qq => qq.r !== host && qq.r !== e.r) || nearPole(gx, gz, 1.5)) continue;
      const yaw = Math.atan2(H.tx, H.tz);
      box(gx, gy + 1.55, gz, 0.14, 3.1, 0.14, yaw);
      it.at = { x: gx, y: gy, z: gz };
      // plate: left half = the left branch, right half = the right branch
      // (inside the PA only the exit's way is shown: the access road is two-way, going on is no route)
      const exitDest = destOf(topo, e.r), thr = host.kind === 'ring' ? throughOf(topo, host, e.dir) : null;
      const left = e.side < 0 ? exitDest : thr, right = e.side < 0 ? thr : exitDest;
      const halves = [[0, left], [1, right]].filter(h => h[1]);
      // host-lateral of the post, in drivers' u
      const uPost = ((gx - H.x) * -H.tz + (gz - H.z) * H.tx) * e.dir, hw = GORE_HALF / 2 * halves.length;
      addPanel(host, e.dir, hs, uPost - hw, uPost + hw, 1.6, 1.5, SMALL, (g, x, y, W, Hh) => {
        const hwid = W / halves.length;
        for (const [k, dest] of halves) {
          const xx = x + (halves.length > 1 ? k : 0) * hwid;
          plate(g, xx, y, hwid, Hh, bgOf(dest));
          arrow(g, xx + (k ? hwid - Hh * 0.26 : Hh * 0.26), y + Hh * 0.25, Hh * 0.36, k ? 45 : -45);
          shield(g, xx + Hh * 0.1 + (k ? 0 : Hh * 0.4), y + Hh * 0.25, Hh * 0.22, dest, bgOf(dest));
          g.fillStyle = WHITE; g.textAlign = 'center'; g.textBaseline = 'middle';
          fit(g, dest.jp, 700, Hh * 0.2, JP, hwid - Hh * 0.2); g.fillText(dest.jp, xx + hwid / 2, y + Hh * 0.53);
          const lines = fitWrap(g, dest.en, 600, Hh * 0.14, EN, hwid - Hh * 0.2);
          if (lines.length === 1) g.fillText(lines[0], xx + hwid / 2, y + Hh * 0.78);
          else { g.fillText(lines[0], xx + hwid / 2, y + Hh * 0.73); g.fillText(lines[1], xx + hwid / 2, y + Hh * 0.87); }
        }
      }, 0.85, 0.1);
    }
  }

  // ---- meshes
  const out = new THREE.Group();
  atlas.finish();
  const byPage = atlas.pages.map(() => ({ pos: [], uv: [], col: [] }));
  for (const p of panels) {
    const { r, d, s, u0, u1, y0, h, tile } = p;
    const P = r.pointAt(s, 0);
    const fx = d * P.tx, fz = d * P.tz; // travel direction
    const rx = -fz, rz = fx; // drivers' right
    const back = p.forward ? p.forward : 0.32; // face stands this far toward the drivers from the post/beam
    const baseX = P.x - fx * back, baseZ = P.z - fz * back;
    const at = u => ({ x: baseX + rx * u, z: baseZ + rz * u });
    const A = at(u0), C = at(u1), yb = P.y + y0, yt = yb + h;
    const G = byPage[tile.page];
    // TL, BL, BR / TL, BR, TR
    const vs = [[A.x, yt, A.z, tile.u0, tile.v1], [A.x, yb, A.z, tile.u0, tile.v0], [C.x, yb, C.z, tile.u1, tile.v0], [A.x, yt, A.z, tile.u0, tile.v1], [C.x, yb, C.z, tile.u1, tile.v0], [C.x, yt, C.z, tile.u1, tile.v1]];
    for (const [x, y, z, u, w] of vs) { G.pos.push(x, y, z); G.uv.push(u, w); G.col.push(p.bright, p.bright, p.bright); }
    // steel back, just behind the face
    const mx = (A.x + C.x) / 2 + fx * 0.09, mz = (A.z + C.z) / 2 + fz * 0.09;
    box(mx, (yb + yt) / 2, mz, u1 - u0 + 0.08, h + 0.08, 0.14, Math.atan2(P.tx, P.tz));
  }
  byPage.forEach((G, k) => {
    if (!G.pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(G.col, 3));
    const t = new THREE.CanvasTexture(atlas.pages[k].c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = world.aniso || 8;
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t, vertexColors: true }));
    out.add(m);
  });
  if (steel.length) { const m = new THREE.Mesh(mergeGeometries(steel), world.mats.steel); m.userData.keepMat = true; out.add(m); }
  world.root.add(out);
  if (world.signage && world.signage.group) disposeGroup(world.root, world.signage.group);
  // for audits
  world.signage = { topo, sites, items, panels, pages: atlas.pages.length, paSigns, group: out };
  return world.signage;
}

// a rebuild (language change) replaces the previous signs: free their geometry, atlas textures and materials
function disposeGroup(root, g) {
  root.remove(g);
  g.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    if (o.material.map) o.material.map.dispose();
    if (!o.userData.keepMat) o.material.dispose(); // (the steel is the world's shared material)
  });
}
