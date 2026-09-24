// Vehicles: parametric toy-style builder, the 15 hero specs (from the reference sheet) and traffic types.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp } from './util.js';
import { textTexture, checkerTexture, flowerTexture, stripeTexture, radialTexture } from './textures.js';
import { JDM_SPECS } from './jdmspecs.js';
import { GlbCarModel } from './glbcars.js';

// ------------------------------------------------------------------ polygon helpers
function topYAt(poly, z) {
  let best = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[0] - z) * (b[0] - z) <= 0 && a[0] !== b[0]) {
      const t = (z - a[0]) / (b[0] - a[0]);
      best = Math.max(best, a[1] + (b[1] - a[1]) * t);
    }
  }
  return best;
}
function frontZAt(poly, y) {
  let best = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) {
      const t = (y - a[1]) / (b[1] - a[1]);
      best = Math.max(best, a[0] + (b[0] - a[0]) * t);
    }
  }
  return best;
}
function rearZAt(poly, y) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) {
      const t = (y - a[1]) / (b[1] - a[1]);
      best = Math.min(best, a[0] + (b[0] - a[0]) * t);
    }
  }
  return best;
}
function clipY(poly, y0, above) {
  const out = [];
  const inside = p => (above ? p[1] >= y0 : p[1] <= y0);
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const ia = inside(A), ib = inside(B);
    if (ia) out.push(A);
    if (ia !== ib) {
      const t = (y0 - A[1]) / (B[1] - A[1]);
      out.push([A[0] + (B[0] - A[0]) * t, y0]);
    }
  }
  return out;
}
// top: front-bottom -> over the top -> rear-bottom. Adds wheel arches along the bottom edge.
function bodyPoly(top, wheels, arches = true) {
  const yb = top[0][1];
  const zF = top[0][0], zR = top[top.length - 1][0];
  const pts = top.map(p => [p[0], p[1]]);
  if (!arches) return pts;
  const ws = wheels.filter(w => w.z > zR + 0.05 && w.z < zF - 0.05).sort((a, b) => a.z - b.z);
  for (const w of ws) {
    const topY = topYAt(top, w.z);
    let ra = Math.min(w.r + 0.05, topY - w.r - 0.07);
    ra = Math.max(ra, w.r + 0.005);
    if (w.r + ra <= yb + 0.02) continue;
    const dy = (w.r - yb) / ra;
    if (dy >= 1 || dy <= -1) continue;
    const beta = Math.asin(dy);
    const N = 14;
    for (let k = 0; k <= N; k++) {
      const a = Math.PI + beta - ((Math.PI + 2 * beta) * k) / N;
      pts.push([w.z + ra * Math.cos(a), w.r + ra * Math.sin(a)]);
    }
  }
  return pts;
}
function bottomYAt(poly, z) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[0] - z) * (b[0] - z) <= 0 && a[0] !== b[0]) {
      const t = (z - a[0]) / (b[0] - a[0]);
      best = Math.min(best, a[1] + (b[1] - a[1]) * t);
    }
  }
  return best;
}

// Rounded body: slices along z; each slice is a squircle cross-section spanning the
// polygon's bottom..top at that z, narrowing towards the roof (tumblehome) and the ends.
function loft(poly, width, { exp = 5, tumble = 0.14, taper = 0.4, endScale = 0.8, slices = 44, perim = 32 } = {}) {
  let z0 = Infinity, z1 = -Infinity;
  for (const p of poly) { z0 = Math.min(z0, p[0]); z1 = Math.max(z1, p[0]); }
  const eps = 0.002;
  const pos = [], idx = [];
  const rings = [];
  let last = null;
  for (let i = 0; i <= slices; i++) {
    const t = i / slices;
    const z = z0 + eps + (z1 - z0 - 2 * eps) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    let yb = bottomYAt(poly, z), yt = topYAt(poly, z);
    if (!isFinite(yb) || !isFinite(yt)) { if (!last) continue; yb = last[0]; yt = last[1]; }
    if (yt < yb + 0.03) yt = yb + 0.03;
    last = [yb, yt];
    const dEnd = Math.min(z - z0, z1 - z);
    const f = dEnd < taper ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - dEnd / taper, 2))) : 1;
    const hw = (width / 2) * (endScale + (1 - endScale) * f);
    const mid = (yb + yt) / 2, hh = (yt - yb) / 2;
    const base = pos.length / 3;
    for (let k = 0; k < perim; k++) {
      const a = (k / perim) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const px = Math.sign(c) * Math.pow(Math.abs(c), 2 / exp);
      const py = Math.sign(s) * Math.pow(Math.abs(s), 2 / exp);
      const x = px * hw * (1 - tumble * Math.max(0, py));
      pos.push(x, mid + py * hh, z);
    }
    rings.push({ base, z, mid });
  }
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r].base, B = rings[r + 1].base;
    for (let k = 0; k < perim; k++) {
      const k2 = (k + 1) % perim;
      idx.push(A + k, A + k2, B + k, A + k2, B + k2, B + k);
    }
  }
  // end caps with their own vertices (crisp edge)
  for (const [ring, front] of [[rings[0], false], [rings[rings.length - 1], true]]) {
    const cb = pos.length / 3;
    for (let k = 0; k < perim; k++) pos.push(pos[(ring.base + k) * 3], pos[(ring.base + k) * 3 + 1], pos[(ring.base + k) * 3 + 2]);
    pos.push(0, ring.mid, ring.z);
    const c = cb + perim;
    for (let k = 0; k < perim; k++) {
      const k2 = (k + 1) % perim;
      if (front) idx.push(c, cb + k, cb + k2); else idx.push(c, cb + k2, cb + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// Split an indexed geometry into triangles below / above a height (two-tone paint).
function splitGeo(g, y) {
  const idx = g.index.array, P = g.attributes.position.array;
  const lo = [], hi = [];
  for (let i = 0; i < idx.length; i += 3) {
    const cy = (P[idx[i] * 3 + 1] + P[idx[i + 1] * 3 + 1] + P[idx[i + 2] * 3 + 1]) / 3;
    (cy < y ? lo : hi).push(idx[i], idx[i + 1], idx[i + 2]);
  }
  const mk = arr => { const n = g.clone(); n.setIndex(arr); return n; };
  return [lo.length ? mk(lo) : null, hi.length ? mk(hi) : null];
}
function rbox(w, h, d) {
  const r = Math.min(w, h, d) * 0.32;
  return new RoundedBoxGeometry(w, h, d, 2, r);
}
function tireGeo(r, w) {
  const hw = w / 2, s = Math.min(0.09, w * 0.22);
  const pts = [[r * 0.62, -hw], [r - s, -hw], [r - s * 0.3, -hw + s * 0.3], [r, -hw + s], [r, hw - s], [r - s * 0.3, hw - s * 0.3], [r - s, hw], [r * 0.62, hw]]
    .map(p => new THREE.Vector2(p[0], p[1]));
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateZ(Math.PI / 2);
  return g;
}
// Rounded fender flare: a torus arc over the wheel, in the z/y plane.
function flareGeo(ra, beta, tube, wide) {
  const g = new THREE.TorusGeometry(ra + tube * 0.7, tube, 10, 28, Math.PI + 2 * beta);
  g.rotateZ(-beta);
  g.rotateY(-Math.PI / 2);
  g.scale(wide, 1, 1);
  return g;
}

function extrude(poly, width, bevel = 0.06) {
  const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(p[0], p[1])));
  const bt = Math.min(bevel, width * 0.2);
  const depth = Math.max(0.005, width - 2 * bt);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bt, bevelSize: bevel * 0.55, bevelSegments: 2, curveSegments: 4,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

// ------------------------------------------------------------------ materials
function hexc(c) { return new THREE.Color(c); }
function makePaint(color, hq) {
  // low metalness keeps the toy-like saturated colors of the reference art; clearcoat adds the gloss
  if (hq) return new THREE.MeshPhysicalMaterial({ color, metalness: 0.05, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.26, envMapIntensity: 0.8 });
  return new THREE.MeshStandardMaterial({ color, metalness: 0.08, roughness: 0.38, envMapIntensity: 0.9 });
}
// Crisp two-tone paint: below `splitY` (car-local height) the lower color is used.
function twoTone(mat, lowColor, splitY, key) {
  const low = new THREE.Color(lowColor);
  mat.onBeforeCompile = sh => {
    sh.uniforms.uSplit = { value: splitY };
    sh.uniforms.uLow = { value: low };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vLY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLY;\nuniform float uSplit;\nuniform vec3 uLow;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(uLow' + (key === 'traffic' ? ' * 1.0' : '') + ', diffuseColor.rgb, step(uSplit, vLY));');
  };
  mat.customProgramCacheKey = () => 'twotone-' + key;
  return mat;
}
export { twoTone };

function makeGlass(color) {
  const c = hexc(color);
  return new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.55), metalness: 0.3, roughness: 0.16, emissive: c, emissiveIntensity: 0.14, envMapIntensity: 1.05 });
}
const SHARED = {};
function shared(key) {
  if (SHARED[key]) return SHARED[key];
  let m;
  switch (key) {
    case 'dark': m = new THREE.MeshStandardMaterial({ color: 0x17191f, roughness: 0.6, metalness: 0.2 }); break;
    case 'black': m = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.5, metalness: 0.3 }); break;
    case 'chrome': m = new THREE.MeshStandardMaterial({ color: 0xdfe4ec, roughness: 0.24, metalness: 1, envMapIntensity: 1.0 }); break;
    case 'grey': m = new THREE.MeshStandardMaterial({ color: 0x6d727d, roughness: 0.45, metalness: 0.5 }); break;
    case 'rubber': m = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.92, metalness: 0 }); break;
    case 'hub': m = new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.5, metalness: 0.6 }); break;
    case 'bronze': m = new THREE.MeshStandardMaterial({ color: 0xc08a36, roughness: 0.3, metalness: 0.9 }); break;
    case 'shadow': m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, alphaMap: radialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]) }); break;
  }
  SHARED[key] = m;
  return m;
}
function lightMat(color, intensity = 1) {
  return new THREE.MeshStandardMaterial({ color: hexc(color).multiplyScalar(0.25), emissive: hexc(color), emissiveIntensity: intensity, roughness: 0.3 });
}

// ------------------------------------------------------------------ hero specs
// Coordinates: z forward (front positive), y up, x left. Units meters.
const ALL_SPECS = [
  {
    id: 'kaiju', name: 'Kaiju GT', brand: 'MECHARA', number: '14', cls: 'Muscle', desc: 'Muscle car largo e barulhento. Traseira solta, adora deslizar.',
    L: 4.4, W: 2.0, wheels: { r: 0.42, w: 0.4, z: [1.38, -1.36], rim: '#ff2d6f' },
    colors: { main: '#ff3fa4', accent: '#1fc8b8', glass: '#8a3cff' },
    body: [[2.18, 0.28], [2.28, 0.52], [2.26, 0.76], [2.02, 0.9], [1.6, 1.0], [1.1, 1.0], [0.55, 1.0], [-0.9, 1.02], [-1.9, 1.05], [-2.2, 1.0], [-2.28, 0.72], [-2.22, 0.28]],
    split: { y: 0.6, color: 'accent' },
    cabin: { pts: [[0.62, 0.99], [0.0, 1.44], [-1.0, 1.46], [-1.6, 1.03]], w: 1.62 },
    stripes: [{ x: 0.3, w: 0.16, color: '#1fc8b8' }, { x: -0.3, w: 0.16, color: '#1fc8b8' }], trim: 'grey',
    wing: { z: -1.95, y: 1.48, w: 1.95, chord: 0.5, color: '#15161b', end: 'main', text: 'MECHARA', textColor: '#ffffff' },
    roofLights: { n: 2, z: -0.05, color: '#fff4d8', spacing: 0.45 },
    parts: [['box', [0.5, 0.12, 0.3], [0, 1.02, 1.3], 'dark'], ['box', [0.22, 0.09, 0.05], [0.62, 0.42, 2.26], 'fog', 0, true], ['box', [1.2, 0.14, 0.08], [0, 0.55, 2.3], 'dark']],
    decals: [{ text: '14', where: 'side', z: 0.2, y: 0.78, h: 0.42, color: '#1fc8b8', stroke: '#2a1030' }],
    head: { y: 0.74, x: 0.68, r: 0.13, shape: 'round' },
    stats: { top: 250, accel: 7.6, grip: 0.9, drift: 1.25, mass: 1450 },
    sound: { type: 'v8', pops: 1 },
  },
  {
    id: 'hauler', name: 'Hauler 55', brand: 'MECHARA', number: '55', cls: 'Caminhão', desc: 'Picape pesada com para-choque de impulsão. Lenta para embalar, impossível de empurrar.',
    L: 5.2, W: 2.3, wheels: { r: 0.52, w: 0.46, z: [1.72, -1.72], rim: '#e63a3a' },
    colors: { main: '#1fae8c', accent: '#b0306a', glass: '#2f5bff' },
    bodies: [
      { top: [[2.62, 0.42], [2.7, 1.28], [2.52, 1.44], [1.25, 1.48], [0.35, 1.48], [0.35, 0.42]], color: 'main' },
      { top: [[0.3, 0.42], [0.3, 1.95], [-2.3, 1.95], [-2.6, 1.62], [-2.62, 0.42]], color: 'accent' },
    ],
    cabin: { pts: [[1.25, 1.46], [0.95, 2.14], [0.4, 2.16], [0.4, 1.46]], w: 2.0 },
    wing: { z: -2.2, y: 2.5, w: 2.2, chord: 0.72, color: '#ff4f9a', end: '#7a3cff', stand: '#7a3cff' },
    roofLights: { n: 3, z: 0.95, color: '#fff4d8', spacing: 0.42 },
    flare: 'dark', frontBumper: 'chrome', bullbar: { color: 'chrome', z: 2.85, h: 1.05 }, grille: { color: 'chrome', y0: 0.55, y1: 1.2, w: 1.3 },
    parts: [['box', [2.34, 0.18, 0.3], [0, 0.5, 2.7], 'grey'], ['box', [2.36, 0.62, 1.2], [0, 1.35, -1.25], 'black', 0, true], ['box', [0.12, 0.5, 0.9], [1.18, 2.2, -2.25], '#7a3cff', 0, false, true]],
    decals: [{ text: '55', where: 'side', z: 0.95, y: 1.02, h: 0.55, color: '#ffd21f', stroke: '#0d3b2f' }, { text: '55', where: 'side', z: -1.25, y: 0.78, h: 0.5, color: '#ffd21f', stroke: '#40102a' }],
    head: { y: 1.02, x: 0.82, w: 0.3, h: 0.18, shape: 'rect' }, tail: { y: 1.1 },
    stats: { top: 195, accel: 5.6, grip: 0.8, drift: 0.65, mass: 3200 },
    sound: { type: 'diesel6', turbo: true },
  },
  {
    id: 'van12', name: 'Van 12', brand: 'CarbeneX', number: '12', cls: 'Van', desc: 'Van quadrada de entregas turbinada. Faróis verdes, muita presença.',
    L: 4.8, W: 2.2, wheels: { r: 0.45, w: 0.42, z: [1.6, -1.55], rim: '#3b3f48' },
    colors: { main: '#ffd21f', accent: '#5d6270', glass: '#1d2130' },
    body: [[2.4, 0.32], [2.48, 0.85], [2.35, 1.12], [1.6, 1.24], [-2.35, 1.26], [-2.42, 0.32]],
    split: { y: 0.62, color: 'accent' },
    cabin: { pts: [[1.6, 1.22], [1.0, 1.97], [0.0, 1.99], [0.0, 1.24]], w: 1.95, roof: 'main' },
    bodies: [{ top: [[0.02, 1.24], [0.02, 1.99], [-2.25, 2.0], [-2.36, 1.26]], color: 'main', w: 2.02 }],
    windows: [[[-0.3, 1.42], [-0.3, 1.82], [-1.6, 1.82], [-1.6, 1.42]]], trim: 'grey',
    wing: { z: -1.9, y: 2.28, w: 2.0, chord: 0.5, color: '#15161b', end: '#15161b', text: 'CarbeneX', textColor: '#ffffff' },
    roofLights: { n: 4, z: 0.55, color: '#fff4d8', spacing: 0.36 },
    grille: { color: 'chrome', y0: 0.45, y1: 0.72, w: 1.4 },
    parts: [['box', [2.24, 0.2, 0.25], [0, 0.42, 2.45], 'grey']],
    decals: [{ text: '12', where: 'side', z: -1.0, y: 1.0, h: 0.5, color: '#3c404a', stroke: '#fff3b0' }],
    head: { y: 0.84, x: 0.74, w: 0.36, h: 0.16, shape: 'rect', color: '#8dff7a' },
    stats: { top: 205, accel: 6.2, grip: 0.82, drift: 0.85, mass: 2200 },
    sound: { type: 'v6', turbo: true },
  },
  {
    id: 'cab04', name: 'Cab-over 04', brand: 'CarbeneX', number: '04', cls: 'Cavalo', desc: 'Cabine avançada de três eixos. Pesado, estável, faz o túnel tremer.',
    L: 5.6, W: 2.35, wheels: { r: 0.48, w: 0.44, z: [1.95, -1.1, -2.05], rim: '#ff4fa3' },
    colors: { main: '#18c0ae', accent: '#3a3d46', glass: '#1f5fd6' },
    bodies: [
      { top: [[2.82, 0.42], [2.88, 2.2], [2.7, 2.46], [1.15, 2.5], [1.15, 0.42]], color: 'main' },
      { top: [[1.1, 0.42], [1.1, 2.05], [-2.72, 2.05], [-2.8, 0.42]], color: 'accent' },
    ],
    windows: [[[2.62, 1.55], [2.62, 2.28], [1.75, 2.28], [1.75, 1.55]]],
    parts: [
      ['box', [2.05, 0.72, 0.06], [0, 1.9, 2.87], 'glass', [-0.08, 0, 0]],
      ['box', [2.3, 0.42, 0.28], [0, 0.62, 2.8], 'dark'],
      ['box', [0.14, 0.1, 0.1], [1.18, 0.62, 0.5], 'amber', 0, true, true], ['box', [0.14, 0.1, 0.1], [1.18, 0.62, -0.6], 'amber', 0, true, true], ['box', [0.14, 0.1, 0.1], [1.18, 0.62, -1.6], 'amber', 0, true, true],
    ],
    wing: { z: 1.45, y: 2.72, w: 2.3, chord: 0.6, color: '#ff3d7f', end: '#ff3d7f', stand: '#20232a', text: 'CarbeneX', textColor: '#15161b', standBase: 2.5 },
    stacks: { z: 1.0, x: 1.02, y0: 1.0, y1: 3.15 }, flare: 'dark',
    roofLights: { n: 2, z: 2.3, color: '#fff4d8', spacing: 0.9, y: 2.56 },
    stripeDecal: { z: -0.85, y: 1.25, w: 3.4, h: 0.9 },
    decals: [{ text: '04', where: 'side', z: -1.9, y: 1.62, h: 0.55, color: '#ffd21f', stroke: '#15161b' }],
    head: { y: 0.98, x: 0.86, w: 0.34, h: 0.2, shape: 'rect' }, tail: { y: 0.8 },
    stats: { top: 185, accel: 5.1, grip: 0.76, drift: 0.5, mass: 4200 },
    sound: { type: 'diesel6', turbo: true, horn: 'air' },
  },
  {
    id: 'hatch18', name: 'Hot Hatch 18', brand: 'XCELLENT', number: '18', cls: 'Hot hatch', desc: 'Compacto leve com compressor no capô. Muda de faixa num piscar.',
    L: 4.0, W: 2.0, wheels: { r: 0.41, w: 0.4, z: [1.28, -1.25], rim: '#ff8a1f' },
    colors: { main: '#ffc41c', accent: '#1d9b5a', glass: '#2c6cff' },
    body: [[2.0, 0.26], [2.08, 0.6], [1.96, 0.84], [1.55, 0.98], [1.3, 1.0], [0.6, 1.0], [-1.25, 1.03], [-1.8, 1.02], [-2.02, 0.95], [-2.05, 0.26]],
    split: { y: 0.52, color: 'accent' },
    cabin: { pts: [[0.62, 0.98], [0.0, 1.5], [-1.35, 1.52], [-1.85, 1.0]], w: 1.6, roofDecal: 'checker' },
    blower: { z: 1.05 }, trim: 'accent',
    wing: { z: -1.75, y: 1.74, w: 1.8, chord: 0.45, color: '#1d9b5a', end: '#1d9b5a', text: 'XCELLENT', textColor: '#ffc41c' },
    parts: [['box', [1.9, 0.08, 0.3], [0, 0.3, 1.95], 'accent']],
    decals: [{ text: '18', where: 'side', z: -0.35, y: 0.76, h: 0.42, color: '#1d9b5a', stroke: '#fff6c8' }],
    head: { y: 0.72, x: 0.62, r: 0.12, shape: 'round' },
    stats: { top: 225, accel: 8.1, grip: 1.05, drift: 1.1, mass: 1050 },
    sound: { type: 'i4turbo', turbo: true },
  },
  {
    id: 'suv21', name: 'Blossom 21', brand: 'AEROVEX', number: '21', cls: 'SUV', desc: 'SUV floral com bagageiro no teto. Suspensão macia, viagem tranquila.',
    L: 4.3, W: 2.1, wheels: { r: 0.47, w: 0.42, z: [1.4, -1.35], rim: '#33d7ff' },
    colors: { main: '#ff8ccf', accent: '#4cc3f2', glass: '#8e3bdc' },
    body: [[2.12, 0.38], [2.2, 0.9], [2.05, 1.08], [1.4, 1.16], [-1.9, 1.18], [-2.15, 1.1], [-2.18, 0.38]],
    split: { y: 0.72, color: 'accent' },
    cabin: { pts: [[1.3, 1.14], [0.75, 1.76], [-1.75, 1.78], [-1.95, 1.16]], w: 1.78, roof: '#4a4f5c' },
    bullbar: { color: 'grey', z: 2.35, h: 1.0 }, trim: 'grey',
    parts: [['box', [1.15, 0.28, 1.05], [0, 1.98, -0.35], '#3fb0ff'], ['box', [0.5, 0.14, 0.25], [0, 1.18, 1.55], 'dark']],
    decals: [{ text: '21', where: 'side', z: -0.9, y: 0.95, h: 0.48, color: '#2f9be0', stroke: '#ffffff' }, { tex: 'flowers', where: 'side', z: 0.45, y: 0.9, h: 0.4, w: 0.9 }],
    head: { y: 0.88, x: 0.7, r: 0.14, shape: 'round' },
    stats: { top: 210, accel: 6.6, grip: 0.86, drift: 0.85, mass: 1900 },
    sound: { type: 'v6' },
  },
  {
    id: 'buggy03', name: 'Buggy 03', brand: 'AEROVEX', number: '03', cls: 'Buggy', desc: 'Buggy de rodas expostas com aros neon. Leve, nervoso, muito divertido.',
    L: 3.8, W: 1.05, wheels: { r: 0.46, w: 0.42, z: [1.3, -1.25], rim: '#26e6ff', x: 0.98, glow: true }, noArches: true,
    colors: { main: '#2f86ff', accent: '#7a3cff', glass: '#8a4cff' },
    body: [[1.9, 0.35], [1.97, 0.6], [1.6, 0.74], [0.4, 0.84], [-1.2, 0.9], [-1.8, 0.8], [-1.85, 0.35]],
    cabin: { pts: [[0.55, 0.8], [0.08, 1.3], [-0.75, 1.32], [-1.2, 0.88]], w: 0.98 },
    roofLights: { n: 4, z: 0.02, color: '#bff4ff', spacing: 0.24, bar: true },
    parts: [
      ['box', [0.28, 0.36, 1.6], [0.62, 0.62, -0.25], 'accent', 0, false, true],
      ['box', [0.5, 0.14, 0.45], [0, 0.9, 1.2], 'dark'],
      ['box', [0.8, 0.05, 0.08], [0.48, 0.45, 1.3], 'dark', 0, false, true], ['box', [0.8, 0.05, 0.08], [0.48, 0.45, -1.25], 'dark', 0, false, true],
      ['box', [1.1, 0.12, 0.35], [0, 0.42, 1.95], 'accent'],
    ],
    wing: { z: -1.65, y: 1.38, w: 1.7, chord: 0.45, color: '#7a3cff', end: 'main', text: '03', textColor: '#ffffff' },
    decals: [{ text: '03', where: 'side', z: 0.9, y: 0.62, h: 0.34, color: '#ffffff', stroke: '#1b2a6b' }],
    head: { y: 0.6, x: 0.32, r: 0.1, shape: 'round' }, tail: { y: 0.62, w: 0.22, x: 0.3 },
    stats: { top: 215, accel: 8.8, grip: 1.1, drift: 1.3, mass: 850 },
    sound: { type: 'boxer' },
  },
  {
    id: 'police72', name: 'Interceptor 72', brand: 'MECHARA', number: '72', cls: 'Supercarro', desc: 'Superesportivo de patrulha. Aderência enorme e velocidade final altíssima.',
    L: 4.6, W: 2.05, wheels: { r: 0.42, w: 0.4, z: [1.45, -1.4], rim: '#2fd3e0' },
    colors: { main: '#f1f3f7', accent: '#2a2f3a', glass: '#2d6bff' },
    body: [[2.3, 0.22], [2.37, 0.46], [2.25, 0.66], [1.95, 0.86], [1.45, 1.0], [0.95, 0.92], [0.6, 0.92], [-0.8, 0.97], [-1.4, 1.04], [-2.0, 1.02], [-2.28, 0.92], [-2.33, 0.22]],
    split: { y: 0.36, color: 'accent' },
    stripes: [{ x: 0.28, w: 0.22, color: '#1b1f27', roof: true }, { x: -0.28, w: 0.22, color: '#1b1f27', roof: true }],
    cabin: { pts: [[0.78, 0.9], [0.05, 1.32], [-0.9, 1.32], [-1.65, 0.96]], w: 1.6 },
    wing: { z: -2.0, y: 1.42, w: 2.05, chord: 0.55, color: '#f1f3f7', end: '#f1f3f7', stand: '#20242c' },
    lightbar: { z: -0.4 }, flare: 'main',
    parts: [['box', [0.9, 0.08, 0.5], [0, 0.93, 1.0], 'dark'], ['box', [1.9, 0.1, 0.3], [0, 0.28, 2.25], 'dark']],
    decals: [{ text: '72', where: 'side', z: -0.1, y: 0.68, h: 0.38, color: '#2c3240', stroke: '#ffffff' }, { text: 'POLICE', where: 'side', z: -1.55, y: 0.66, h: 0.2, color: '#2c3240', italic: false }, { text: '72', where: 'roof', z: -0.4, h: 0.5, color: '#2c3240' }],
    head: { y: 0.58, x: 0.72, r: 0.17, shape: 'round', color: '#7fc0ff' },
    stats: { top: 285, accel: 8.6, grip: 1.12, drift: 0.9, mass: 1500 },
    sound: { type: 'v8', pops: 0.6 },
  },
  {
    id: 'formula06', name: 'Formula 06', brand: 'CarbeneX', number: '06', cls: 'Monoposto', desc: 'Monoposto de rua com asas verdes. O mais rápido e o mais grudado no asfalto.',
    L: 5.0, W: 0.92, wheels: { list: [{ z: 1.7, r: 0.4, w: 0.38 }, { z: -1.55, r: 0.46, w: 0.5 }], rim: '#45ff6a', x: 0.9 }, noArches: true,
    colors: { main: '#22262e', accent: '#37e05a', glass: '#37e05a' },
    body: [[2.5, 0.22], [2.52, 0.36], [1.2, 0.6], [0.4, 0.74], [-0.1, 0.95], [-1.2, 1.02], [-2.0, 0.82], [-2.3, 0.45], [-2.32, 0.22]],
    stripes: [{ x: 0, w: 0.16, color: '#37e05a' }],
    cabin: { pts: [[0.45, 0.72], [-0.05, 1.12], [-0.85, 1.16], [-1.3, 0.98]], w: 0.72, roof: false },
    parts: [
      ['box', [0.42, 0.46, 1.7], [0.6, 0.45, -0.35], 'main', 0, false, true], ['box', [0.44, 0.06, 1.5], [0.6, 0.7, -0.35], 'accent', 0, false, true],
      ['box', [2.05, 0.05, 0.5], [0, 0.3, 2.35], 'accent'], ['box', [0.05, 0.22, 0.6], [1.02, 0.36, 2.35], 'main', 0, false, true],
      ['box', [0.7, 0.05, 0.08], [0.45, 0.42, 1.7], 'dark', 0, false, true], ['box', [0.7, 0.05, 0.08], [0.45, 0.5, -1.55], 'dark', 0, false, true],
      ['box', [0.26, 0.12, 0.3], [0, 1.18, -1.45], 'accent'],
    ],
    wing: { z: -2.15, y: 1.18, w: 1.5, chord: 0.5, color: '#37e05a', end: 'main', text: 'CarbeneX', textColor: '#15161b' },
    decals: [{ text: '06', where: 'side', z: -0.9, y: 0.78, h: 0.3, color: '#37e05a', stroke: '#101214' }],
    head: { y: 0.36, x: 0.72, w: 0.26, h: 0.06, shape: 'rect', zOff: -0.05, atZ: 2.6 }, tail: { y: 0.62, w: 0.3, x: 0.0, h: 0.1 },
    stats: { top: 310, accel: 10.0, grip: 1.3, drift: 0.6, mass: 750 },
    sound: { type: 'v10', pops: 0.3 },
  },
  {
    id: 'rally88', name: 'Rally 88', brand: 'MECHARA', number: '88', cls: 'Rali', desc: 'Carro de rali com barra de faróis. Traseira solta, perfeita para curvas longas.',
    L: 4.3, W: 2.05, wheels: { r: 0.44, w: 0.42, z: [1.35, -1.33], rim: '#3aa8ff' },
    colors: { main: '#f4f6fa', accent: '#62b8ff', glass: '#3b7dff' },
    body: [[2.15, 0.28], [2.22, 0.6], [2.1, 0.84], [1.75, 0.98], [1.35, 1.06], [0.7, 1.02], [-1.3, 1.07], [-1.8, 1.05], [-2.15, 0.96], [-2.2, 0.28]],
    split: { y: 0.58, color: 'accent' },
    cabin: { pts: [[0.78, 1.0], [0.15, 1.5], [-1.1, 1.52], [-1.7, 1.04]], w: 1.62 },
    blower: { z: 1.1 },
    wing: { z: -1.9, y: 1.72, w: 1.9, chord: 0.5, color: '#15161b', end: 'accent', text: 'MECHARA', textColor: '#ffffff' },
    roofLights: { n: 4, z: 0.12, color: '#fff4d8', spacing: 0.34, bar: true }, trim: 'black',
    parts: [['box', [2.0, 0.07, 0.35], [0, 0.3, 2.15], 'dark'], ['box', [0.2, 0.09, 0.05], [0.55, 0.45, 2.2], 'fog', 0, true, true]],
    decals: [{ text: '88', where: 'side', z: -0.3, y: 0.8, h: 0.44, color: '#ffd21f', stroke: '#1a1a1a' }, { text: '88', where: 'roof', z: -0.5, h: 0.55, color: '#ffd21f', stroke: '#1a1a1a' }],
    head: { y: 0.74, x: 0.64, r: 0.13, shape: 'round' },
    stats: { top: 240, accel: 8.2, grip: 1.0, drift: 1.45, mass: 1250 },
    sound: { type: 'i4rally', turbo: true },
  },
  {
    id: 'ranger98', name: 'Ranger 98', brand: 'NEONDRIVE', number: '98', cls: 'Picape', desc: 'Picape amarela com barril na caçamba e cinco faróis no teto.',
    L: 4.9, W: 2.15, wheels: { r: 0.48, w: 0.44, z: [1.55, -1.5], rim: '#202228', lip: '#ffd31c' },
    colors: { main: '#ffd31c', accent: '#1d1f24', glass: '#245c45' },
    bodies: [
      { top: [[2.45, 0.42], [2.5, 1.1], [2.35, 1.24], [1.0, 1.3], [-0.5, 1.32], [-0.5, 0.42]], color: 'main' },
      { top: [[-0.52, 0.42], [-0.52, 1.25], [-2.42, 1.25], [-2.48, 0.42]], color: 'main' },
    ],
    split: { y: 0.72, color: 'accent' },
    cabin: { pts: [[0.98, 1.28], [0.5, 1.92], [-0.45, 1.94], [-0.45, 1.3]], w: 1.8, roof: 'accent' },
    roofLights: { n: 5, z: 0.35, color: '#fff4d8', spacing: 0.3 },
    bullbar: { color: 'black', z: 2.7, h: 1.05 }, trim: 'black',
    stacks: { z: -0.62, x: 0.88, y0: 1.2, y1: 2.35, one: true },
    parts: [['box', [1.85, 0.06, 1.7], [0, 1.26, -1.47], 'black'], ['cyl', [0.34, 1.3], [0, 1.62, -1.45], 'bronze', [0, 0, Math.PI / 2]], ['box', [0.9, 0.1, 0.6], [0, 1.33, 1.8], 'accent']],
    decals: [{ text: '98', where: 'side', z: 0.3, y: 0.98, h: 0.5, color: '#1d1f24', stroke: '#fff2a0' }, { text: 'NEONDRIVE', where: 'side', z: -1.5, y: 0.98, h: 0.16, color: '#1d1f24', italic: false }],
    head: { y: 0.96, x: 0.76, w: 0.32, h: 0.16, shape: 'rect' },
    stats: { top: 210, accel: 6.6, grip: 0.86, drift: 0.9, mass: 2300 },
    sound: { type: 'v8big', pops: 0.5 },
  },
  {
    id: 'rod94', name: 'Hot Rod 94', brand: 'CarbeneX', number: '94', cls: 'Hot rod', desc: 'Hot rod limão com oito cornetas laranja. Torque bruto e rodas à mostra.',
    L: 4.3, W: 1.4, wheels: { r: 0.45, w: 0.42, z: [1.45, -1.35], rim: '#b8ff3c', x: 0.96 }, noArches: true,
    colors: { main: '#8fe32b', accent: '#ff8a1f', glass: '#1f4a24' },
    body: [[2.15, 0.33], [2.2, 0.6], [1.5, 0.74], [0.3, 0.86], [-0.4, 0.96], [-1.8, 1.0], [-2.15, 0.9], [-2.17, 0.33]],
    stripes: [{ x: 0, w: 0.3, color: '#ff8a1f' }],
    cabin: { pts: [[0.3, 0.84], [-0.15, 1.36], [-1.2, 1.38], [-1.5, 0.98]], w: 1.28, roof: 'accent' },
    parts: [
      ['box', [0.5, 0.16, 1.05], [0.96, 1.0, -1.35], 'main', 0, false, true], ['box', [0.34, 0.12, 0.8], [0.96, 0.98, 1.45], 'main', 0, false, true],
      ['box', [0.8, 0.3, 0.9], [0, 0.86, 1.25], 'chrome'],
      ['box', [0.7, 0.05, 0.08], [0.55, 0.45, 1.45], 'dark', 0, false, true], ['box', [0.7, 0.05, 0.08], [0.55, 0.45, -1.35], 'dark', 0, false, true],
    ],
    stacks8: { z: 1.25, y: 1.0 },
    wing: { z: -1.95, y: 1.38, w: 1.7, chord: 0.45, color: '#8fe32b', end: 'accent' },
    decals: [{ text: '94', where: 'side', z: -0.9, y: 0.72, h: 0.38, color: '#ff8a1f', stroke: '#1a2a08' }],
    head: { y: 0.6, x: 0.55, r: 0.12, shape: 'round' },
    stats: { top: 245, accel: 8.7, grip: 0.92, drift: 1.3, mass: 1100 },
    sound: { type: 'v8', pops: 1.2 },
  },
  {
    id: 'brute27', name: 'Brute 27', brand: 'CarbeneX', number: '27', cls: 'Muscle', desc: 'Muscle roxo com blower cromado gigante. Ronco grave, arrancada forte.',
    L: 4.5, W: 2.05, wheels: { r: 0.44, w: 0.42, z: [1.42, -1.38], rim: '#1d1f25', lip: '#5cff3a' },
    colors: { main: '#7b2ff0', accent: '#4a1ca0', glass: '#241c3a' },
    body: [[2.25, 0.28], [2.3, 0.6], [2.2, 0.86], [1.8, 0.98], [1.42, 1.06], [1.0, 1.02], [0.6, 1.0], [-1.0, 1.03], [-1.38, 1.07], [-1.9, 1.05], [-2.25, 0.98], [-2.28, 0.28]],
    split: { y: 0.45, color: 'accent' },
    cabin: { pts: [[0.6, 0.98], [0.0, 1.42], [-1.1, 1.43], [-1.75, 1.0]], w: 1.62 },
    blower: { z: 1.0, big: true },
    wing: { z: -2.05, y: 1.22, w: 1.9, chord: 0.35, color: '#15161b', end: '#5cff3a' },
    parts: [['box', [1.4, 0.3, 0.08], [0, 0.6, 2.27], 'dark']],
    decals: [{ text: '27', where: 'side', z: 0.0, y: 0.72, h: 0.46, color: '#5cff3a', stroke: '#1a0b3a' }, { text: '27', where: 'roof', z: -0.55, h: 0.6, color: '#5cff3a', stroke: '#1a0b3a' }, { text: 'CarbeneX', where: 'side', z: 1.35, y: 0.55, h: 0.16, color: '#ffffff', italic: false }],
    head: { y: 0.72, x: 0.68, r: 0.13, shape: 'round' },
    stats: { top: 265, accel: 8.5, grip: 0.9, drift: 1.25, mass: 1550 },
    sound: { type: 'v8big', blower: true, pops: 1 },
  },
  {
    id: 'bolt99', name: 'Bolt 99', brand: 'NEONDRIVE', number: '99', cls: 'Street muscle', desc: 'Muscle azul com deck traseiro iluminado e escapes à mostra no capô.',
    L: 4.6, W: 2.1, wheels: { r: 0.45, w: 0.42, z: [1.45, -1.42], rim: '#1d1f25', lip: '#ff7a1a' },
    colors: { main: '#2f6dff', accent: '#1c1e25', glass: '#6b3514' },
    body: [[2.3, 0.32], [2.36, 0.7], [2.2, 0.92], [1.8, 1.02], [1.45, 1.08], [0.6, 1.05], [-1.42, 1.1], [-2.25, 1.08], [-2.3, 0.32]],
    split: { y: 0.55, color: 'accent' },
    cabin: { pts: [[0.55, 1.03], [0.05, 1.5], [-0.9, 1.52], [-1.2, 1.05]], w: 1.7 },
    roofLights: { n: 4, z: 0.0, color: '#ff8a2a', spacing: 0.34 },
    bullbar: { color: 'black', z: 2.55, h: 0.95 }, trim: 'black',
    parts: [['box', [1.8, 0.1, 0.95], [0, 1.12, -1.75], 'accent']],
    deckLights: { z: -1.75, y: 1.19, nx: 3, nz: 2, color: '#ff8a2a' },
    stacks6: { z: 1.2 },
    decals: [{ text: '99', where: 'side', z: -0.25, y: 0.8, h: 0.46, color: '#ff7a1a', stroke: '#0c1a4a' }, { text: 'NEONDRIVE', where: 'side', z: 1.2, y: 0.46, h: 0.15, color: '#ffffff', italic: false }],
    head: { y: 0.76, x: 0.7, r: 0.13, shape: 'round' },
    stats: { top: 250, accel: 7.9, grip: 0.9, drift: 1.1, mass: 1650 },
    sound: { type: 'v8', pops: 0.9 },
  },
  {
    id: 'aero01', name: 'Aero 01', brand: 'AEROVEX', number: '01', cls: 'Esportivo', desc: 'Cunha esportiva dos anos 80 com vidros roxos. Equilibrado e veloz.',
    L: 4.6, W: 2.05, wheels: { r: 0.42, w: 0.4, z: [1.45, -1.42], rim: '#d33cff' },
    colors: { main: '#1fd1a0', accent: '#16302b', glass: '#7d3cff' },
    body: [[2.3, 0.22], [2.38, 0.46], [2.25, 0.62], [1.9, 0.84], [1.45, 0.99], [1.0, 0.9], [0.5, 0.88], [-0.9, 0.96], [-1.42, 1.02], [-2.0, 1.0], [-2.3, 0.95], [-2.33, 0.22]],
    split: { y: 0.36, color: 'accent' },
    cabin: { pts: [[0.55, 0.86], [-0.05, 1.28], [-1.0, 1.3], [-1.7, 0.98]], w: 1.6 },
    roofLights: { n: 3, z: -0.1, color: '#fff4d8', spacing: 0.3 },
    parts: [['box', [0.9, 0.06, 0.7], [0, 0.93, 1.35], 'black'], ['box', [0.3, 0.1, 0.4], [0.25, 0.97, 1.3], 'black', 0, false, true], ['box', [1.9, 0.12, 0.18], [0, 1.02, -2.18], 'black']],
    decals: [{ text: '01', where: 'side', z: -0.25, y: 0.66, h: 0.4, color: '#16302b', stroke: '#ffffff' }, { text: '01', where: 'roof', z: -0.5, h: 0.55, color: '#16302b', stroke: '#ffffff' }, { text: 'AEROVEX', where: 'side', z: 1.35, y: 0.62, h: 0.16, color: '#ffffff', italic: false }],
    head: { y: 0.52, x: 0.72, w: 0.36, h: 0.09, shape: 'rect' },
    stats: { top: 275, accel: 8.3, grip: 1.05, drift: 1.0, mass: 1300 },
    sound: { type: 'flat6', turbo: true },
  },
];

// removed from the game: Hauler 55, Van 12, Cab-over 04
// the drivable cars are the realistic glTF models; the procedural specs above stay available as a fallback
export const HERO_SPECS = JDM_SPECS;

// ------------------------------------------------------------------ builder
const decalCache = new Map();
function decalTexture(d) {
  const key = JSON.stringify([d.text, d.color, d.stroke, d.italic, d.tex]);
  if (decalCache.has(key)) return decalCache.get(key);
  let t;
  if (d.tex === 'flowers') t = flowerTexture('#3fa9f5');
  else if (d.tex === 'checker') t = checkerTexture();
  else if (d.tex === 'chevron') t = stripeTexture();
  else {
    const long = d.text.length > 3;
    t = textTexture(d.text, { w: long ? 1024 : 256, h: long ? 160 : 160, color: d.color, stroke: d.stroke || null, strokeW: 0.1, italic: d.italic !== false, size: 0.82 });
  }
  decalCache.set(key, t);
  return t;
}
function textAspect(d) { if (d.w) return d.w / d.h; return d.text && d.text.length > 3 ? 6.4 : 1.6; }

// Toy proportions of the reference art: shorter, taller bodies with bigger wheels.
const KZ = 0.88, KY = 1.1;
function toy(src) {
  const s = JSON.parse(JSON.stringify(src));
  s.stats = src.stats; s.sound = src.sound;
  const pt = a => a && a.map(p => [p[0] * KZ, p[1] * KY]);
  const zy = o => { if (!o) return; if (o.z !== undefined) o.z *= KZ; if (o.y !== undefined) o.y *= KY; };
  s.L *= KZ;
  if (s.wheels.z) s.wheels.z = s.wheels.z.map(z => z * KZ);
  if (s.wheels.r) s.wheels.r *= KY;
  if (s.wheels.list) for (const w of s.wheels.list) { w.z *= KZ; w.r *= KY; }
  if (s.body) s.body = pt(s.body);
  if (s.bodies) for (const b of s.bodies) b.top = pt(b.top);
  if (s.cabin) s.cabin.pts = pt(s.cabin.pts);
  if (s.windows) s.windows = s.windows.map(pt);
  if (s.split) s.split.y *= KY;
  if (s.wing) { zy(s.wing); s.wing.chord *= KZ; if (s.wing.standBase !== undefined) s.wing.standBase *= KY; }
  for (const k of ['roofLights', 'blower', 'stacks8', 'stacks6', 'deckLights', 'helmet', 'lightbar']) zy(s[k]);
  if (s.bullbar) { s.bullbar.z *= KZ; s.bullbar.h *= KY; }
  if (s.grille) { s.grille.y0 *= KY; s.grille.y1 *= KY; }
  if (s.stacks) { s.stacks.z *= KZ; s.stacks.y0 *= KY; s.stacks.y1 *= KY; }
  if (s.stripeDecal) { zy(s.stripeDecal); s.stripeDecal.w *= KZ; }
  for (const p of s.parts || []) {
    p[2] = [p[2][0], p[2][1] * KY, p[2][2] * KZ];
    if (p[0] === 'box') p[1] = [p[1][0], p[1][1] * KY, p[1][2] * KZ];
  }
  for (const d of s.decals || []) zy(d);
  s.head.y *= KY;
  if (s.head.atZ !== undefined) s.head.atZ *= KZ;
  if (s.tail && s.tail.y) s.tail.y *= KY;
  return s;
}

export class CarModel {
  constructor(srcSpec, { hq = true } = {}) {
    if (srcSpec.glb) { const m = new GlbCarModel(srcSpec); if (arguments[1] && arguments[1].paint) m.setPaint(arguments[1].paint); return m; } // eslint-disable-line no-constructor-return
    const spec = toy(srcSpec);
    this.spec = srcSpec;
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.wheels = [];
    this.L = spec.L;
    this.W = spec.W;
    const colors = spec.colors;
    const mats = { main: makePaint(colors.main, hq), accent: makePaint(colors.accent || colors.main, hq), glass: makeGlass(colors.glass) };
    const matFor = key => {
      if (!key) return mats.main;
      if (mats[key]) return mats[key];
      if (key === 'fog') return (mats.fog = lightMat('#ffd84a', 2.2));
      if (key === 'amber') return (mats.amber = mats.amber || lightMat('#ff9a1a', 2.0));
      if (['dark', 'black', 'chrome', 'grey', 'bronze'].includes(key)) return shared(key);
      if (key[0] === '#') return (mats[key] = mats[key] || makePaint(key, false));
      return mats.main;
    };
    this.matFor = matFor;
    const statics = [];
    const add = (geo, mat, x = 0, y = 0, z = 0, rot = null) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
      m.updateMatrix();
      statics.push(m);
      return m;
    };
    const wheelsList = spec.wheels.list || spec.wheels.z.map(z => ({ z, r: spec.wheels.r, w: spec.wheels.w }));
    this.wheelDefs = wheelsList;

    // ---- body shells
    const bodies = [];
    if (spec.body) bodies.push({ top: spec.body, color: 'main', w: spec.W, main: true });
    if (spec.bodies) for (const b of spec.bodies) bodies.push({ top: b.top, color: b.color, w: b.w || spec.W, main: !spec.body });
    const polys = [];
    for (const b of bodies) {
      const poly = bodyPoly(b.top, wheelsList, !spec.noArches);
      polys.push(poly);
      const upper = b.top[0][1] > 0.9;
      const tall = Math.max(...poly.map(q => q[1])) - Math.min(...poly.map(q => q[1])) > 1.25;
      const g = loft(poly, b.w, { exp: tall ? 9 : upper ? 7 : 5.5, tumble: tall ? 0.05 : upper ? 0.14 : 0.12, taper: Math.min(0.5, b.w * 0.22), endScale: spec.noArches ? 0.6 : 0.82 });
      if (spec.split && b.top[0][1] < spec.split.y) {
        const key = 'split:' + b.color;
        if (!mats[key]) {
          const lowHex = colors[spec.split.color] || spec.split.color;
          const base = matFor(b.color).color.getHexString();
          mats[key] = twoTone(makePaint('#' + base, hq), lowHex, spec.split.y, spec.id + b.color);
        }
        add(g, mats[key]);
      } else add(g, matFor(b.color));
      for (const s of spec.stripes || []) {
        // stripe = a thin, slightly larger shell of the body clipped to the top surface
        const sg = loft(poly, s.w, { exp: 8, tumble: 0, taper: 0.3, endScale: 0.9 });
        const m = add(sg, matFor(s.color), s.x, 0.012, 0);
        m.scale.set(1, 1.003, 1.004);
        m.updateMatrix();
      }
    }
    this.poly = polys[0];
    const fullPoly = polys.flat();
    const topAt = z => { let y = -Infinity; for (const p of polys) y = Math.max(y, topYAt(p, z)); return y; };
    this.topAt = topAt;

    // ---- cabin / greenhouse
    let cabinTop = 0;
    if (spec.cabin) {
      const c = spec.cabin;
      // glass greenhouse sits a little into the body so the rounded base never floats
      const gp = c.pts.map(p => [p[0], p[1]]);
      const minY0 = Math.min(...gp.map(p => p[1]));
      for (const p of gp) if (p[1] <= minY0 + 0.02) p[1] -= 0.12;
      add(loft(gp, c.w, { exp: 4, tumble: 0.22, taper: 0.35, endScale: 0.85 }), mats.glass);
      const maxY = Math.max(...c.pts.map(p => p[1]));
      cabinTop = maxY;
      const roof = clipY(c.pts, maxY - 0.1, true);
      if (roof.length > 2 && c.roof !== false) {
        add(loft(roof, c.w * 0.86 + 0.06, { exp: 3.5, tumble: 0.2, taper: 0.3, endScale: 0.8 }), matFor(c.roof || 'main'), 0, 0.02, 0);
        for (const s of spec.stripes || []) if (s.roof) add(loft(roof, s.w, { exp: 6, tumble: 0, taper: 0.2 }), matFor(s.color), s.x, 0.035, 0);
      }
      if (c.roofDecal === 'checker') {
        const zz = c.pts.map(p => p[0]).filter((_, i) => c.pts[i][1] > maxY - 0.05);
        const len = Math.max(...zz) - Math.min(...zz);
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(c.w * 0.8, Math.max(0.3, len * 0.85)), new THREE.MeshStandardMaterial({ map: decalTexture({ tex: 'checker' }), roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }));
        pl.rotation.x = -Math.PI / 2;
        pl.position.set(0, maxY + 0.07, (Math.max(...zz) + Math.min(...zz)) / 2);
        this.body.add(pl);
      }
    }
    for (const w of spec.windows || []) add(extrude(w, (spec.bodies && spec.bodies[spec.bodies.length - 1].w || spec.W) + 0.04, 0.0), mats.glass);

    // ---- wheels
    const wx = spec.wheels.x;
    for (const wd of wheelsList) {
      for (const sgn of [1, -1]) {
        const pivot = new THREE.Group();
        const x = sgn * (wx !== undefined ? wx : spec.W / 2 - wd.w * 0.1);
        pivot.position.set(x, wd.r, wd.z);
        const spin = new THREE.Group();
        pivot.add(spin);
        const tire = new THREE.Mesh(tireGeo(wd.r, wd.w), shared('rubber'));
        spin.add(tire);
        const rimMat = spec.wheels.glow ? lightMat(spec.wheels.rim, 1.4) : (mats.rim = mats.rim || new THREE.MeshStandardMaterial({ color: spec.wheels.rim, metalness: 0.6, roughness: 0.28 }));
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(wd.r * 0.66, wd.r * 0.66, wd.w + 0.02, 20), rimMat);
        rim.rotation.z = Math.PI / 2;
        spin.add(rim);
        const inner = new THREE.Mesh(new THREE.CylinderGeometry(wd.r * 0.5, wd.r * 0.5, wd.w + 0.03, 16), shared('hub'));
        inner.rotation.z = Math.PI / 2;
        spin.add(inner);
        for (let k = 0; k < 3; k++) {
          const sp = new THREE.Mesh(new THREE.BoxGeometry(wd.w + 0.045, wd.r * 1.02, 0.075), rimMat);
          sp.rotation.x = (k / 3) * Math.PI;
          spin.add(sp);
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(wd.r * 0.13, wd.r * 0.13, wd.w + 0.07, 8), shared('chrome'));
        hub.rotation.z = Math.PI / 2;
        spin.add(hub);
        if (spec.wheels.lip) {
          const lip = new THREE.Mesh(new THREE.TorusGeometry(wd.r * 0.67, 0.025, 6, 24), new THREE.MeshStandardMaterial({ color: spec.wheels.lip, metalness: 0.5, roughness: 0.3 }));
          lip.rotation.y = Math.PI / 2;
          lip.position.x = sgn * (wd.w / 2 + 0.012);
          spin.add(lip);
        }
        this.group.add(pivot);
        this.wheels.push({ pivot, spin, front: wd.z > 0, r: wd.r });
      }
    }

    // ---- fender flares, bumpers and side skirts (the chunky toy look of the reference sheet)
    if (!spec.noArches) {
      const halfWAt = z => {
        let hw = spec.W / 2;
        for (const b of spec.bodies || []) {
          const zs = b.top.map(p => p[0]);
          if (b.top[0][1] < 1 && z <= Math.max(...zs) && z >= Math.min(...zs)) hw = (b.w || spec.W) / 2;
        }
        return hw;
      };
      const flareKey = spec.flare !== undefined ? spec.flare : spec.split ? spec.split.color : 'dark';
      const trimKey = spec.trim || 'dark';
      const yb0 = (spec.body || spec.bodies[0].top)[0][1];
      if (flareKey) for (const wd of wheelsList) {
        const topY = topAt(wd.z);
        if (!isFinite(topY)) continue;
        const ra = Math.max(wd.r + 0.005, Math.min(wd.r + 0.05, topY - wd.r - 0.07));
        const beta = Math.asin(clamp((wd.r - yb0) / (ra + 0.1), -0.9, 0.9));
        const hw = halfWAt(wd.z);
        for (const sgn of [1, -1]) {
          const fg = flareGeo(ra, beta, 0.1, 1.9);
          add(fg, matFor(flareKey), sgn * (hw - 0.04), wd.r, wd.z);
        }
      }
      // bumpers
      const allTop = [...(spec.body ? [spec.body] : []), ...(spec.bodies || []).map(b => b.top)].filter(t => t[0][1] < 1);
      const fz = Math.max(...allTop.map(t => t[0][0])), rz = Math.min(...allTop.map(t => t[t.length - 1][0]));
      const by = yb0 + 0.1;
      add(rbox(spec.W * 0.92, 0.26, 0.34), matFor(spec.frontBumper || trimKey), 0, by, fz - 0.08);
      add(rbox(spec.W * 0.9, 0.24, 0.3), matFor(trimKey), 0, by, rz + 0.08);
      // side skirts between the arches
      const zs = wheelsList.map(w => w.z).sort((a, b) => a - b);
      const zr = zs[0] + wheelsList[0].r + 0.2, zf = zs[zs.length - 1] - wheelsList[0].r - 0.2;
      if (zf - zr > 0.3) for (const sgn of [1, -1]) add(rbox(0.16, 0.16, zf - zr), matFor(trimKey), sgn * (halfWAt((zf + zr) / 2) - 0.02), yb0 + 0.06, (zf + zr) / 2);
    }

    // ---- lights
    const H = spec.head;
    this.lightMats = {
      head: lightMat(H.color || '#fff3d6', 0.4),
      tail: lightMat('#ff2030', 0.6),
      rev: lightMat('#f4f6ff', 0.0),
      bl: lightMat('#ffa01a', 0.0),
      br: lightMat('#ffa01a', 0.0),
      extra: [],
    };
    const headZ = H.atZ !== undefined ? H.atZ : frontZAt(fullPoly, H.y) + 0.005;
    this.headLocal = [];
    for (const sgn of [1, -1]) {
      let m;
      if (H.shape === 'round') {
        m = new THREE.Mesh(new THREE.CylinderGeometry(H.r, H.r, 0.08, 18), this.lightMats.head);
        m.rotation.x = Math.PI / 2;
      } else m = new THREE.Mesh(new THREE.BoxGeometry(H.w, H.h, 0.08), this.lightMats.head);
      m.position.set(sgn * H.x, H.y, headZ + (H.zOff || 0));
      this.body.add(m);
      this.headLocal.push(new THREE.Vector3(sgn * H.x, H.y, headZ + 0.05));
      // blinker front
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.06), sgn > 0 ? this.lightMats.bl : this.lightMats.br);
      const by = Math.max(0.3, H.y - 0.2);
      b.position.set(sgn * Math.min(spec.W / 2 - 0.12, H.x + 0.25), by, frontZAt(fullPoly, by) + 0.01);
      if (isFinite(b.position.z)) this.body.add(b);
    }
    const T = spec.tail || {};
    const ty = T.y || H.y + 0.05;
    const tz = rearZAt(fullPoly, ty) - 0.005;
    this.tailLocal = [];
    const tw = T.w || 0.4, tx = T.x !== undefined ? T.x : spec.W / 2 - 0.28;
    for (const sgn of (tx === 0 ? [1] : [1, -1])) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(tw, T.h || 0.13, 0.08), this.lightMats.tail);
      m.position.set(sgn * tx, ty, tz);
      this.body.add(m);
      this.tailLocal.push(new THREE.Vector3(sgn * tx, ty, tz - 0.05));
      if (tx !== 0) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.07), sgn > 0 ? this.lightMats.bl : this.lightMats.br);
        b.position.set(sgn * Math.min(spec.W / 2 - 0.08, tx + tw / 2 + 0.06), ty, tz);
        this.body.add(b);
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.07), this.lightMats.rev);
        r.position.set(sgn * (tx - tw / 2 - 0.1), ty - 0.02, tz);
        this.body.add(r);
      }
    }

    // ---- extras
    const bodyTop = z => topAt(z);
    if (spec.wing) this._wing(spec.wing, matFor, add, bodyTop);
    if (spec.blower) {
      const b = spec.blower, y = bodyTop(b.z), s = b.big ? 1.25 : 1;
      add(rbox(0.62 * s, 0.24 * s, 0.72 * s), shared('chrome'), 0, y + 0.1 * s, b.z);
      add(rbox(0.48 * s, 0.26 * s, 0.4 * s), shared('dark'), 0, y + 0.33 * s, b.z + 0.05);
      add(new THREE.BoxGeometry(0.5 * s, 0.05, 0.42 * s), shared('chrome'), 0, y + 0.47 * s, b.z + 0.05);
      for (let k = -1; k <= 1; k += 2) add(new THREE.CylinderGeometry(0.09 * s, 0.09 * s, 0.7 * s, 10), shared('chrome'), k * 0.2 * s, y + 0.12 * s, b.z, [Math.PI / 2, 0, 0]);
    }
    if (spec.roofLights) {
      const R = spec.roofLights;
      const y = R.y || (spec.cabin ? topYAt(spec.cabin.pts, R.z) : bodyTop(R.z)) + 0.1;
      const lm = lightMat(R.color, 0.8);
      this.lightMats.extra.push(lm);
      if (R.bar) add(new THREE.BoxGeometry(R.n * R.spacing + 0.1, 0.08, 0.12), shared('dark'), 0, y - 0.03, R.z - 0.02);
      for (let k = 0; k < R.n; k++) {
        const x = (k - (R.n - 1) / 2) * R.spacing;
        add(new THREE.CylinderGeometry(0.11, 0.11, 0.14, 12), shared('chrome'), x, y + 0.05, R.z, [Math.PI / 2, 0, 0]);
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 12), lm);
        lens.rotation.x = Math.PI / 2;
        lens.position.set(x, y + 0.05, R.z + 0.075);
        this.body.add(lens);
      }
    }
    if (spec.bullbar) {
      const B = spec.bullbar, m = matFor(B.color);
      for (const x of [-0.55, 0.55]) add(new THREE.BoxGeometry(0.08, B.h - 0.3, 0.08), m, x, 0.3 + (B.h - 0.3) / 2, B.z);
      add(new THREE.BoxGeometry(1.5, 0.08, 0.08), m, 0, B.h - 0.05, B.z);
      add(new THREE.BoxGeometry(1.8, 0.08, 0.08), m, 0, 0.5, B.z + 0.05);
      for (const x of [-0.85, 0.85]) add(new THREE.BoxGeometry(0.08, 0.08, 0.5), m, x, 0.5, B.z - 0.2);
    }
    if (spec.grille) {
      const G = spec.grille, m = matFor(G.color), z = frontZAt(fullPoly, (G.y0 + G.y1) / 2) + 0.02;
      const n = 9;
      for (let k = 0; k < n; k++) add(new THREE.BoxGeometry(0.05, G.y1 - G.y0, 0.05), m, (k / (n - 1) - 0.5) * G.w, (G.y0 + G.y1) / 2, z);
      add(new THREE.BoxGeometry(G.w + 0.1, 0.06, 0.06), m, 0, G.y1, z);
    }
    if (spec.stacks) {
      const S = spec.stacks;
      for (const sgn of S.one ? [1] : [1, -1]) add(new THREE.CylinderGeometry(0.08, 0.09, S.y1 - S.y0, 10), shared('chrome'), sgn * S.x, (S.y0 + S.y1) / 2, S.z);
    }
    if (spec.stacks8) {
      const S = spec.stacks8, om = matFor('accent');
      for (let k = 0; k < 8; k++) {
        const x = (k % 2 ? 1 : -1) * 0.22, z = S.z + 0.3 - Math.floor(k / 2) * 0.2;
        add(new THREE.CylinderGeometry(0.07, 0.06, 0.34, 10), om, x, S.y + 0.17, z, [-0.25, 0, 0]);
      }
    }
    if (spec.stacks6) {
      const S = spec.stacks6, y = bodyTop(S.z);
      for (let k = 0; k < 6; k++) add(new THREE.CylinderGeometry(0.06, 0.06, 0.24, 8), shared('chrome'), ((k % 3) - 1) * 0.22, y + 0.12, S.z + (k < 3 ? 0.14 : -0.14));
    }
    if (spec.deckLights) {
      const D = spec.deckLights, lm = lightMat(D.color, 1.2);
      this.lightMats.extra.push(lm);
      for (let a = 0; a < D.nx; a++) for (let b = 0; b < D.nz; b++) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 12), lm);
        m.position.set((a - (D.nx - 1) / 2) * 0.45, D.y, D.z + (b - (D.nz - 1) / 2) * 0.4);
        this.body.add(m);
      }
    }
    if (spec.helmet) {
      const Hm = spec.helmet;
      add(new THREE.SphereGeometry(0.22, 14, 10), makePaint(Hm.color, false), 0, Hm.y, Hm.z);
      add(new THREE.BoxGeometry(0.3, 0.1, 0.1), shared('black'), 0, Hm.y + 0.02, Hm.z + 0.17);
    }
    if (spec.lightbar) {
      const y = cabinTop + 0.08;
      this.lightMats.police = [lightMat('#ff1830', 0.5), lightMat('#1a5cff', 0.5)];
      add(new THREE.BoxGeometry(1.2, 0.08, 0.26), shared('dark'), 0, y - 0.02, spec.lightbar.z);
      for (let k = 0; k < 2; k++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.22), this.lightMats.police[k]);
        m.position.set(k ? -0.3 : 0.3, y + 0.06, spec.lightbar.z);
        this.body.add(m);
      }
    }
    if (spec.stripeDecal) {
      const S = spec.stripeDecal;
      for (const sgn of [1, -1]) {
        const t = decalTexture({ tex: 'chevron' });
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }));
        pl.position.set(sgn * (spec.W / 2 + 0.012), S.y, S.z);
        pl.rotation.y = sgn * Math.PI / 2;
        this.body.add(pl);
      }
    }
    for (const p of spec.parts || []) {
      const [kind, size, pos, color, rot, emissive, mirror] = p;
      let geo;
      if (kind === 'box') geo = emissive ? new THREE.BoxGeometry(size[0], size[1], size[2]) : rbox(size[0], size[1], size[2]);
      else geo = new THREE.CylinderGeometry(size[0], size[0], size[1], 16);
      const mat = matFor(color);
      const xs = mirror ? [pos[0], -pos[0]] : [pos[0]];
      for (const x of xs) {
        if (emissive) {
          const m = new THREE.Mesh(geo, mat);
          m.position.set(x, pos[1], pos[2]);
          if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
          this.body.add(m);
          if (!this.lightMats.extra.includes(mat)) this.lightMats.extra.push(mat);
        } else add(geo, mat, x, pos[1], pos[2], rot || null);
      }
    }
    // decals
    for (const d of spec.decals || []) {
      const t = decalTexture(d);
      const h = d.h, w = h * textAspect(d);
      const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.4, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false });
      if (d.where === 'side') {
        let halfW = spec.W / 2;
        if (spec.bodies) for (const b of spec.bodies) if (b.w && d.z <= Math.max(...b.top.map(p => p[0])) && d.z >= Math.min(...b.top.map(p => p[0]))) halfW = b.w / 2;
        for (const sgn of [1, -1]) {
          const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
          pl.position.set(sgn * (halfW + 0.014), d.y, d.z);
          pl.rotation.y = sgn * Math.PI / 2;
          this.body.add(pl);
        }
      } else if (d.where === 'roof' && spec.cabin) {
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        pl.rotation.set(-Math.PI / 2, 0, Math.PI);
        pl.position.set(0, cabinTop + 0.075, d.z);
        this.body.add(pl);
      }
    }
    // contact shadow
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(spec.W + 0.9, spec.L + 1.0), shared('shadow'));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.03;
    sh.renderOrder = -1;
    this.group.add(sh);

    // merge statics by material
    const byMat = new Map();
    for (const m of statics) {
      if (!byMat.has(m.material)) byMat.set(m.material, []);
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrix);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
      g.clearGroups();
      byMat.get(m.material).push(g);
    }
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      this.body.add(mesh);
    }
    const box = new THREE.Box3().setFromObject(this.body);
    this.H = box.max.y;
    this.wheelbase = Math.max(...wheelsList.map(w => w.z)) - Math.min(...wheelsList.map(w => w.z));
    this.group.traverse(o => { if (o.isMesh && o !== sh) o.castShadow = true; });
    this._blink = 0;
  }

  _wing(W, matFor, add, bodyTop) {
    const m = matFor(W.color);
    add(rbox(W.w, 0.09, W.chord), m, 0, W.y, W.z, [0.1, 0, 0]);
    const em = matFor(W.end || W.color);
    for (const s of [1, -1]) add(rbox(0.07, 0.36, W.chord + 0.14), em, s * (W.w / 2 + 0.02), W.y - 0.06, W.z);
    const sm = matFor(W.stand || '#15161b');
    const base = W.standBase !== undefined ? W.standBase : bodyTop(W.z);
    const h = W.y - base;
    if (h > 0.02) for (const s of [1, -1]) add(new THREE.BoxGeometry(0.06, h + 0.05, 0.2), sm, s * W.w * 0.28, base + h / 2, W.z);
    if (W.text) {
      const t = decalTexture({ text: W.text, color: W.textColor || '#fff', italic: true });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(W.w * 0.78, W.chord * 0.62), new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 0.4 }));
      // faces up and reads left-to-right from the chase camera behind the car
      pl.rotation.set(-Math.PI / 2 + 0.1, 0, Math.PI);
      pl.position.set(0, W.y + 0.042, W.z);
      this.body.add(pl);
    }
  }

  // state: {head, brake, reverse, left, right, police}
  setLights(st) {
    const L = this.lightMats;
    L.head.emissiveIntensity = st.head ? 1.6 : 0.2;
    L.tail.emissiveIntensity = st.brake ? 2.4 : st.head ? 0.8 : 0.3;
    L.rev.emissiveIntensity = st.reverse ? 2.5 : 0;
    L.bl.emissiveIntensity = st.left ? 4 : 0;
    L.br.emissiveIntensity = st.right ? 4 : 0;
    for (const m of L.extra) m.emissiveIntensity = st.head ? 1.4 : 0.4;
    if (L.police) {
      const t = performance.now() / 1000;
      const on = st.police;
      L.police[0].emissiveIntensity = on ? (Math.sin(t * 14) > 0 ? 6 : 0.2) : 0.5;
      L.police[1].emissiveIntensity = on ? (Math.sin(t * 14) > 0 ? 0.2 : 6) : 0.5;
    }
  }

  updateWheels(dt, speed, steer) {
    for (const w of this.wheels) {
      w.spin.rotation.x += (speed / w.r) * dt;
      if (w.front) w.pivot.rotation.y = steer;
    }
  }

  dispose() {
    const shared = new Set(Object.values(SHARED));
    this.group.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (!shared.has(m)) m.dispose(); // maps are cached/shared and stay alive
    });
  }
}

// ------------------------------------------------------------------ traffic
export const TRAFFIC_TYPES = [
  {
    id: 'sedan', weight: 30, v: [80, 112], colors: ['#e9ebee', '#b9bec6', '#1b1d22', '#30343c', '#23324f', '#6e1f24', '#c9c2b4', '#8c9199'],
    L: 4.7, W: 1.8, wheels: { r: 0.33, w: 0.24, z: [1.45, -1.35] },
    body: [[2.35, 0.22], [2.38, 0.55], [2.25, 0.72], [1.4, 0.84], [-1.6, 0.9], [-2.3, 0.85], [-2.35, 0.22]],
    cabin: [[0.95, 0.83], [0.25, 1.35], [-0.95, 1.36], [-1.65, 0.88]], cw: 1.5, head: { y: 0.66, x: 0.62 }, tail: { y: 0.72, x: 0.62 },
  },
  {
    id: 'kei', weight: 16, v: [72, 98], colors: ['#f0f0ec', '#9fd3c7', '#e8c35a', '#c7c9cc', '#e58a8a', '#5a86c4'],
    L: 3.4, W: 1.48, wheels: { r: 0.28, w: 0.2, z: [1.12, -1.08] },
    body: [[1.7, 0.2], [1.72, 0.6], [1.6, 0.82], [1.3, 0.9], [-1.68, 0.92], [-1.7, 0.2]],
    cabin: [[1.3, 0.88], [0.95, 1.62], [-1.6, 1.66], [-1.65, 0.9]], cw: 1.36, head: { y: 0.7, x: 0.5 }, tail: { y: 0.8, x: 0.55 },
  },
  {
    id: 'taxi', weight: 12, v: [75, 100], colors: ['#141416', '#e3b21c', '#2f6b3a', '#c65a1e', '#e8e8e8', '#8a1f2a'],
    L: 4.6, W: 1.72, wheels: { r: 0.32, w: 0.22, z: [1.4, -1.35] },
    body: [[2.3, 0.22], [2.33, 0.6], [2.2, 0.8], [1.2, 0.87], [-1.7, 0.9], [-2.28, 0.86], [-2.3, 0.22]],
    cabin: [[0.9, 0.86], [0.35, 1.42], [-0.95, 1.43], [-1.45, 0.88]], cw: 1.46, head: { y: 0.68, x: 0.58 }, tail: { y: 0.74, x: 0.6 }, sign: [0, 1.56, -0.3],
  },
  {
    id: 'minivan', weight: 14, v: [78, 105], colors: ['#f2f2f2', '#2a2c31', '#9aa3ad', '#3c4d63', '#6b6f75'],
    L: 4.8, W: 1.85, wheels: { r: 0.34, w: 0.24, z: [1.5, -1.4] },
    body: [[2.4, 0.22], [2.42, 0.62], [2.2, 0.88], [1.6, 0.96], [-2.35, 0.98], [-2.4, 0.22]],
    cabin: [[1.6, 0.94], [0.9, 1.72], [-2.2, 1.75], [-2.35, 0.98]], cw: 1.7, head: { y: 0.74, x: 0.66 }, tail: { y: 1.1, x: 0.8 },
  },
  {
    id: 'coupe', weight: 8, v: [95, 130], colors: ['#c01f2a', '#f2f2f2', '#15171b', '#2a5bd6', '#e0a21a', '#7c8088'],
    L: 4.4, W: 1.8, wheels: { r: 0.32, w: 0.24, z: [1.35, -1.3] },
    body: [[2.2, 0.2], [2.25, 0.5], [2.1, 0.66], [1.6, 0.78], [1.2, 0.8], [-1.5, 0.84], [-2.15, 0.8], [-2.2, 0.2]],
    cabin: [[0.7, 0.79], [0.05, 1.2], [-0.9, 1.21], [-1.5, 0.83]], cw: 1.45, head: { y: 0.56, x: 0.64 }, tail: { y: 0.66, x: 0.64 },
  },
  {
    id: 'truck', weight: 10, v: [70, 88], heavy: true, colors: ['#e8e8e6', '#d9dcdf', '#2c4a7a', '#a52a2a', '#dcd6c6'],
    L: 7.6, W: 2.3, wheels: { r: 0.45, w: 0.3, z: [2.6, -1.8, -2.8] },
    bodies: [
      [[3.8, 0.45], [3.83, 1.35], [3.65, 1.5], [2.45, 1.52], [2.45, 0.45]],
      [[2.35, 0.55], [2.35, 3.15], [-3.8, 3.15], [-3.8, 0.55]],
    ],
    cabin: [[3.65, 1.48], [3.45, 2.5], [2.5, 2.55], [2.5, 1.5]], cw: 2.2, head: { y: 0.75, x: 0.8 }, tail: { y: 0.75, x: 0.95 },
  },
  {
    id: 'bus', weight: 5, v: [70, 85], heavy: true, colors: ['#e8e8e4', '#3d7cc9', '#2f8f5e', '#d4a21c'],
    L: 11, W: 2.5, wheels: { r: 0.5, w: 0.32, z: [3.6, -3.0] },
    bodies: [[[5.5, 0.35], [5.55, 3.0], [5.3, 3.2], [-5.4, 3.2], [-5.5, 3.0], [-5.5, 0.35]]],
    band: [[5.36, 1.4], [5.42, 2.75], [-5.25, 2.75], [-5.25, 1.4]], head: { y: 0.8, x: 0.9 }, tail: { y: 1.0, x: 1.0 },
  },
];

// Merge a traffic type into one geometry with vertex colors (white = body, instance color tints it).
export function buildTrafficGeometry(t) {
  const parts = [];
  const push = (g, col, m) => {
    let geo = g.index ? g.toNonIndexed() : g;
    if (m) geo.applyMatrix4(m);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal'].includes(k)) geo.deleteAttribute(k);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    const cc = new THREE.Color(col);
    for (let i = 0; i < n; i++) { c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geo.clearGroups();
    parts.push(geo);
  };
  const wheels = t.wheels.z.map(z => ({ z, r: t.wheels.r, w: t.wheels.w }));
  const polys = [];
  if (t.body) polys.push(bodyPoly(t.body, wheels));
  for (const b of t.bodies || []) polys.push(bodyPoly(b, wheels));
  for (const p of polys) {
    const upper = p[0][1] > 0.9 && p.length < 8;
    push(loft(p, t.W, { exp: upper ? 4 : 4.5, tumble: 0.1, taper: 0.35, endScale: 0.85, slices: 22, perim: 20 }), '#ffffff');
  }
  if (t.cabin) {
    const cp = t.cabin.map(q => [q[0], q[1]]); const cm = Math.min(...cp.map(q => q[1])); for (const q of cp) if (q[1] <= cm + 0.02) q[1] -= 0.1;
    push(loft(cp, t.cw, { exp: 3.2, tumble: 0.25, taper: 0.3, endScale: 0.85, slices: 16, perim: 20 }), '#101217');
    const maxY = Math.max(...t.cabin.map(p => p[1]));
    const roof = clipY(t.cabin, maxY - 0.06, true);
    if (roof.length > 2) push(loft(roof, t.cw * 0.86 + 0.05, { exp: 3.5, tumble: 0.2, taper: 0.25, slices: 10, perim: 20 }), '#ffffff', new THREE.Matrix4().makeTranslation(0, 0.015, 0));
  }
  if (t.band) push(extrude(t.band, t.W + 0.03, 0), '#0e1014');
  if (t.sign) push(new THREE.BoxGeometry(0.5, 0.2, 0.18), '#ffffff', new THREE.Matrix4().makeTranslation(t.sign[0], t.sign[1], t.sign[2]));
  for (const w of wheels) for (const s of [1, -1]) {
    const g = tireGeo(w.r, w.w);
    push(g, '#131417', new THREE.Matrix4().makeTranslation(s * (t.W / 2 - w.w * 0.4), w.r, w.z));
    const h = new THREE.CylinderGeometry(w.r * 0.55, w.r * 0.55, w.w + 0.02, 10);
    h.rotateZ(Math.PI / 2);
    push(h, '#8a8f98', new THREE.Matrix4().makeTranslation(s * (t.W / 2 - w.w * 0.4), w.r, w.z));
  }
  const geo = mergeGeometries(parts, false);
  const full = polys.flat();
  const hz = frontZAt(full, t.head.y) + 0.03, tz = rearZAt(full, t.tail.y) - 0.03;
  return {
    geo,
    head: [[t.head.x, t.head.y, hz], [-t.head.x, t.head.y, hz]],
    tail: [[t.tail.x, t.tail.y, tz], [-t.tail.x, t.tail.y, tz]],
    sign: t.sign ? [t.sign[0], t.sign[1] + 0.02, t.sign[2]] : null,
    halfL: t.L / 2, halfW: t.W / 2,
  };
}
