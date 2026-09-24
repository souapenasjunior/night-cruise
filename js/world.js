// World construction: road geometry, structures, city, sky and ambient lighting.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp, lerp, wrap } from './util.js';
import * as TX from './textures.js';
import { RING_HW, RAMP_HW } from './network.js';

const SODIUM = new THREE.Color('#ffb05a');
const LED = new THREE.Color('#dfe8ff');
const TUNNEL = new THREE.Color('#ffa648');

// ------------------------------------------------------------------ generic sweep along a ribbon
// profile: [[off, dy], ...] where dy may be a function of sample index. ranges: [[i0, count], ...]
function sweep(r, profile, ranges, { uScale = 4, vScale = 4 } = {}) {
  const pos = [], uv = [], idx = [];
  const P = r.px, Y = r.py, Z = r.pz;
  const val = (q, i) => (typeof q === 'function' ? q(i) : q);
  for (const [i0, count] of ranges) {
    if (count < 2) continue;
    for (let j = 0; j < profile.length - 1; j++) {
      const base = pos.length / 3;
      for (let k = 0; k < count; k++) {
        const i = r.closed ? (i0 + k) % r.n : Math.min(i0 + k, r.n - 1);
        const rx = -r.tz[i], rz = r.tx[i];
        const s = (i0 + k) * r.ds;
        const ao = val(profile[j][0], i), ay = val(profile[j][1], i);
        const bo = val(profile[j + 1][0], i), by = val(profile[j + 1][1], i);
        pos.push(P[i] + rx * ao, Y[i] + ay, Z[i] + rz * ao, P[i] + rx * bo, Y[i] + by, Z[i] + rz * bo);
        uv.push(s / uScale, 0, s / uScale, Math.hypot(bo - ao, by - ay) / vScale);
      }
      for (let k = 0; k < count - 1; k++) {
        const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// contiguous ranges of sample indices where pred(i) is true (handles closed wrap)
function rangesWhere(r, pred) {
  const out = [];
  let start = -1;
  for (let i = 0; i < r.n; i++) {
    const ok = pred(i);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) { out.push([start, i - start + 1]); start = -1; }
  }
  if (start >= 0) {
    if (r.closed && out.length && out[0][0] === 0) { const first = out.shift(); out.push([start, r.n - start + first[1]]); }
    else out.push([start, r.n - start]);
  }
  if (r.closed && out.length === 1 && out[0][1] >= r.n) out[0][1] = r.n + 1;
  return out;
}

// ------------------------------------------------------------------ shaders
const buildingVert = /* glsl */`
attribute float aSeed;
attribute vec3 aTint;
varying vec3 vWPos;
varying vec3 vWNormal;
varying float vSeed;
varying vec3 vTint;
varying float vTop;
#include <fog_pars_vertex>
void main(){
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vWNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vSeed = aSeed; vTint = aTint;
  vTop = (modelMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).y;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const buildingFrag = /* glsl */`
uniform float uLit;
varying vec3 vWPos;
varying vec3 vWNormal;
varying float vSeed;
varying vec3 vTint;
varying float vTop;
#include <fog_pars_fragment>
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec3 n = normalize(vWNormal);
  vec3 col;
  float ratio = 0.18 + 0.55 * fract(vSeed * 7.31);
  if (abs(n.y) > 0.5) {
    col = vTint * 0.035 + vec3(0.012, 0.013, 0.02);
  } else {
    float style = fract(vSeed * 3.17);
    vec2 cell = style < 0.5 ? vec2(3.2, 3.6) : (style < 0.8 ? vec2(1.9, 3.6) : vec2(6.0, 4.2));
    vec2 uv = vec2(dot(vWPos.xz, vec2(-n.z, n.x)), vWPos.y);
    vec2 c = floor(uv / cell);
    vec2 f = fract(uv / cell);
    float wx = style < 0.8 ? 0.16 : 0.05;
    float win = step(wx, f.x) * step(f.x, 1.0 - wx) * step(0.26, f.y) * step(f.y, 0.84);
    float h = hash(c + vSeed * 17.0 + n.xz * 3.0);
    float floorLit = step(hash(vec2(c.y, vSeed * 9.0)), 0.8);
    float lit = step(h, ratio) * floorLit;
    float h2 = hash(c * 1.37 + vSeed);
    vec3 wc = mix(vec3(1.0, 0.72, 0.42), vec3(0.72, 0.84, 1.0), step(0.62, h2));
    wc = mix(wc, vec3(1.0, 0.93, 0.82), step(0.9, h2));
    float bright = 0.55 + 0.9 * hash(c + 3.1);
    float fw = max(fwidth(uv.x / cell.x), fwidth(uv.y / cell.y));
    float aa = clamp(fw * 1.6 - 0.35, 0.0, 1.0);
    float pattern = mix(win * lit * bright, ratio * 0.45, aa);
    vec3 facade = vTint * 0.06 + vec3(0.016, 0.018, 0.028);
    vec3 glassDark = vec3(0.03, 0.04, 0.06);
    col = mix(facade, glassDark, win * (1.0 - aa) * 0.6);
    col += wc * pattern * 1.35 * uLit;
    // street-level glow and roof trim
    col += vec3(1.0, 0.75, 0.45) * 0.25 * smoothstep(8.0, 0.0, vWPos.y) * uLit;
    col += vTint * 0.5 * smoothstep(vTop - 1.2, vTop, vWPos.y) * step(0.7, fract(vSeed * 5.1));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const groundVert = /* glsl */`
varying vec3 vWPos;
#include <fog_pars_vertex>
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const groundFrag = /* glsl */`
uniform float uTime;
varying vec3 vWPos;
#include <fog_pars_fragment>
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 p = vWPos.xz;
  float B = 115.0;
  vec2 id = floor(p / B + 0.5);
  vec2 q = p - id * B;          // local coords, streets along q.x=0 and q.y=0 lines
  float sw = 7.0;
  float onX = step(abs(q.y), sw);  // street running along x
  float onZ = step(abs(q.x), sw);  // street running along z
  float street = max(onX, onZ);
  float blockH = hash(id);
  vec3 base = mix(vec3(0.012, 0.013, 0.018), vec3(0.02, 0.026, 0.02), step(0.86, blockH));
  vec3 col = mix(base, vec3(0.03, 0.031, 0.036), street);
  float fw = fwidth(p.x) + fwidth(p.y);
  float fade = clamp(1.0 - fw * 0.9, 0.0, 1.0);
  // lamp glows along streets
  float la = mod(p.x + 14.0, 28.0) - 14.0;
  float lb = mod(p.y + 14.0, 28.0) - 14.0;
  float ay = abs(q.y) - 6.0, ax = abs(q.x) - 6.0;
  float g1 = exp(-(la * la + ay * ay) / 18.0) * onX;
  float g2 = exp(-(lb * lb + ax * ax) / 18.0) * onZ;
  col += vec3(1.0, 0.66, 0.32) * (g1 + g2) * 0.55 * fade;
  // soft wide glow so the city floor is not black from far away
  col += vec3(0.9, 0.55, 0.3) * street * 0.035;
  // moving car lights
  float ya = q.y - 2.2, yb = q.y + 2.2, xa = q.x - 2.2, xb = q.x + 2.2;
  float laneA = exp(-ya * ya * 3.0) * onX;
  float laneB = exp(-yb * yb * 3.0) * onX;
  float m1 = step(0.94, fract((p.x + uTime * 13.0 + hash(vec2(id.y, 1.0)) * 90.0) / 47.0));
  float m2 = step(0.94, fract((p.x - uTime * 11.0 + hash(vec2(id.y, 2.0)) * 90.0) / 53.0));
  float laneC = exp(-xa * xa * 3.0) * onZ;
  float laneD = exp(-xb * xb * 3.0) * onZ;
  float m3 = step(0.94, fract((p.y + uTime * 12.0 + hash(vec2(id.x, 3.0)) * 90.0) / 51.0));
  float m4 = step(0.94, fract((p.y - uTime * 12.5 + hash(vec2(id.x, 4.0)) * 90.0) / 43.0));
  col += (vec3(1.0, 0.95, 0.85) * (laneA * m1 + laneC * m3) + vec3(1.0, 0.1, 0.08) * (laneB * m2 + laneD * m4)) * 1.4 * fade;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const skyVert = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const skyFrag = /* glsl */`
uniform sampler2D uSkyline;
uniform vec3 uZen;
uniform vec3 uHor;
uniform vec3 uGlow;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHor, uZen, smoothstep(0.0, 0.55, h));
  col += uGlow * exp(-max(h, 0.0) * 9.0) * 0.8;
  // stars
  vec2 sp = floor(vec2(atan(d.z, d.x) * 300.0, h * 300.0));
  float st = step(0.9975, hash(sp)) * smoothstep(0.12, 0.5, h);
  col += vec3(0.7, 0.75, 0.9) * st * 0.7;
  // moon
  vec3 md = normalize(vec3(-0.45, 0.32, -0.83));
  float mdot = dot(d, md);
  col += vec3(0.95, 0.92, 0.85) * smoothstep(0.99955, 0.9997, mdot) * 1.08;
  col += vec3(0.3, 0.32, 0.4) * pow(max(mdot, 0.0), 400.0) * 0.6;
  // distant skyline band
  float az = atan(d.z, d.x) / 6.28318 + 0.5;
  float v = h / 0.085;
  if (v > -0.05 && v < 1.0) {
    vec4 s = texture2D(uSkyline, vec2(az * 3.0, clamp(v, 0.0, 1.0)));
    col = mix(col, s.rgb * 1.2, s.a);
  }
  if (h < 0.0) col = mix(uHor * 0.6, col, 0.0);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const streakVert = /* glsl */`
attribute vec3 iPos;
attribute vec3 iCol;
attribute vec2 iSize;
uniform vec3 uCam;
uniform float uStrength;
varying vec2 vUv;
varying vec3 vCol;
#include <fog_pars_vertex>
void main(){
  vec2 d = uCam.xz - iPos.xz;
  float dist = length(d);
  d /= max(dist, 0.001);
  vec2 side = vec2(-d.y, d.x);
  float len = iSize.y * clamp(dist / 35.0, 0.25, 1.0);
  vec3 wp = vec3(iPos.x + side.x * position.x * iSize.x + d.x * position.y * len, iPos.y, iPos.z + side.y * position.x * iSize.x + d.y * position.y * len);
  vUv = vec2(position.x * 2.0, position.y);
  vCol = iCol * uStrength;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const streakFrag = /* glsl */`
varying vec2 vUv;
varying vec3 vCol;
#include <fog_pars_fragment>
void main(){
  float a = exp(-vUv.x * vUv.x * 6.0) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.4) * smoothstep(0.0, 0.08, vUv.y);
  gl_FragColor = vec4(max(vCol * a, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Streaks {
  constructor(max) {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max * 2);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iCol', new THREE.InstancedBufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(this.size, 2).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    this.max = max;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uCam: { value: new THREE.Vector3() }, uStrength: { value: 1 } }]),
      vertexShader: streakVert, fragmentShader: streakFrag, fog: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(x, y, z, c, w, len) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.size[i * 2] = w; this.size[i * 2 + 1] = len;
  }
  end() {
    this.geo.instanceCount = this.n;
    for (const k of ['iPos', 'iCol', 'iSize']) this.geo.attributes[k].needsUpdate = true;
  }
}

// ------------------------------------------------------------------ world
export class World {
  constructor(scene, net, settings) {
    this.scene = scene;
    this.net = net;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.lamps = []; // {x,y,z,color,tunnel}
    this.tunnels = new Map(); // ribbon id -> [[s0,s1]]
    this.time = 0;
    this.q = settings;
    const texQ = { low: 0.5, medium: 0.75, high: 1 }[settings.textures] || 1;
    this.aniso = settings.textures === 'low' ? 1 : settings.textures === 'medium' ? 4 : 8;
    this.tex = {
      ring: TX.roadTexture(TX.RING_ROAD, texQ, this.aniso),
      link: TX.roadTexture(TX.LINK_ROAD, texQ, this.aniso),
      lot: TX.roadTexture(TX.LOT_ROAD, texQ, this.aniso),
      concrete: TX.concreteTexture(),
      tunnel: TX.tunnelTexture(),
      pool: TX.poolTexture(),
      glow: TX.radialTexture(64),
    };
    this.mats = {
      ring: new THREE.MeshStandardMaterial({ map: this.tex.ring, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      link: new THREE.MeshStandardMaterial({ map: this.tex.link, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.25 }),
      // bays overlap the access road by 1 m: draw on top there instead of z-fighting
      lot: new THREE.MeshStandardMaterial({ map: this.tex.lot, roughness: 0.84, metalness: 0.0, envMapIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      paint: new THREE.MeshStandardMaterial({ color: 0xd9d8cf, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
      // gore infill reads as more road surface (plain asphalt, like the bays)
      gore: new THREE.MeshStandardMaterial({ map: this.tex.lot, roughness: 0.84, metalness: 0.0, envMapIntensity: 0.25, side: THREE.DoubleSide }),
      walk: new THREE.MeshStandardMaterial({ map: this.tex.concrete, color: 0x7d7e84, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      concrete: new THREE.MeshStandardMaterial({ map: this.tex.concrete, color: 0x9a9aa0, roughness: 0.85, side: THREE.DoubleSide }),
      deck: new THREE.MeshStandardMaterial({ map: this.tex.concrete, color: 0x6c6d74, roughness: 0.9, side: THREE.DoubleSide }),
      rail: new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.5, metalness: 0.8, side: THREE.DoubleSide }),
      soundwall: new THREE.MeshStandardMaterial({ color: 0x6f8fa0, roughness: 0.4, metalness: 0.3, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
      tunnel: new THREE.MeshStandardMaterial({ map: this.tex.tunnel, color: 0xc7bfae, roughness: 0.75, side: THREE.DoubleSide }),
      tunnelOut: new THREE.MeshStandardMaterial({ color: 0x1a221c, roughness: 1, side: THREE.DoubleSide }),
      steel: new THREE.MeshStandardMaterial({ color: 0x4d535c, roughness: 0.5, metalness: 0.7 }),
      pillar: new THREE.MeshStandardMaterial({ map: this.tex.concrete, color: 0x75767c, roughness: 0.9 }),
    };
    this._build();
  }

  setTextureQuality(level) {
    const texQ = { low: 0.5, medium: 0.75, high: 1 }[level] || 1;
    this.aniso = level === 'low' ? 1 : level === 'medium' ? 4 : 8;
    for (const k of ['ring', 'link', 'lot']) {
      const old = this.tex[k];
      this.tex[k] = TX.roadTexture(k === 'ring' ? TX.RING_ROAD : k === 'lot' ? TX.LOT_ROAD : TX.LINK_ROAD, texQ, this.aniso);
      this.mats[k].map = this.tex[k];
      this.mats[k].needsUpdate = true;
      if (k === 'lot') { this.mats.gore.map = this.tex.lot; this.mats.gore.needsUpdate = true; }
      old.dispose();
    }
  }

  _build() {
    const net = this.net;
    this._sky();
    this._groundWater();
    for (const r of net.ribbons) this._ribbon(r);
    this._pillars();
    this._lampsBuild();
    this._signs();
    this._bridge();
    this._landmarks();
    this._city();
  }

  // ---------------------------------------------------------------- sky & ground
  _sky() {
    const g = new THREE.SphereGeometry(2500, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uSkyline: { value: TX.skylineTexture() },
        uZen: { value: new THREE.Color('#03050d') },
        uHor: { value: new THREE.Color('#1b1730') },
        uGlow: { value: new THREE.Color('#3a2238') },
      },
      vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(g, this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  _groundWater() {
    const shore = 1150;
    const gg = new THREE.PlaneGeometry(14000, 7000 + shore, 1, 1);
    gg.rotateX(-Math.PI / 2);
    gg.translate(0, 0, (shore - 7000) / 2);
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      vertexShader: groundVert, fragmentShader: groundFrag, fog: true,
    });
    const ground = new THREE.Mesh(gg, this.groundMat);
    ground.renderOrder = -5;
    this.root.add(ground);
    // water
    const wn = TX.waterNormalTexture();
    wn.repeat.set(220, 80);
    this.waterNormal = wn;
    const wg = new THREE.PlaneGeometry(14000, 5000, 1, 1);
    wg.rotateX(-Math.PI / 2);
    wg.translate(0, -1.2, shore + 2500);
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x060a14, roughness: 0.08, metalness: 0.9, normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 0.55 });
    this.root.add(new THREE.Mesh(wg, this.waterMat));
    // quay
    const qg = new THREE.BoxGeometry(14000, 2.4, 6);
    qg.translate(0, -0.2, shore);
    this.root.add(new THREE.Mesh(qg, this.mats.deck));
  }

  // ---------------------------------------------------------------- roads
  _ribbon(r) {
    const net = this.net;
    const hw = r.hw;
    const isRing = r.kind === 'ring';
    // tunnel ranges
    const tunnelPred = i => isRing && r.py[i] < 4.2;
    const tRanges = rangesWhere(r, tunnelPred);
    this.tunnels.set(r.id, tRanges.map(([i0, c]) => [i0 * r.ds, (i0 + c) * r.ds]));
    r.tunnelRanges = this.tunnels.get(r.id);
    // open edges
    const res = [];
    const openL = new Uint8Array(r.n), openR = new Uint8Array(r.n);
    for (let i = 0; i < r.n; i++) {
      for (const sg of [-1, 1]) {
        // same test as the car's wall check (probe ~0.5 m past the edge, 1.5 m height tolerance),
        // so a parapet stands exactly where the physics has a wall and nowhere else
        const off = sg * (hw + 0.5);
        const x = r.px[i] - r.tz[i] * off, z = r.pz[i] + r.tx[i] * off;
        net.surfacesAt(x, z, r.py[i], 1.5, 0, res);
        const other = res.some(q => q.r !== r);
        if (other) (sg < 0 ? openL : openR)[i] = 1;
      }
    }
    r.openL = openL; r.openR = openR;
    // distance from each edge to the nearest other deck at the same level (Infinity: none within 2.6 m)
    const gapL = new Float32Array(r.n).fill(Infinity), gapR = new Float32Array(r.n).fill(Infinity);
    for (let i = 0; i < r.n; i++) {
      for (const sg of [-1, 1]) {
        for (let t = 0.2; t <= 2.61; t += 0.4) {
          const off = sg * (hw + t);
          net.surfacesAt(r.px[i] - r.tz[i] * off, r.pz[i] + r.tx[i] * off, r.py[i], 1.2, 0, res);
          if (res.some(q => q.r !== r)) { (sg < 0 ? gapL : gapR)[i] = t; break; }
        }
      }
    }
    // ranges grown by one sample in front (rangesWhere already runs one sample past the end), so
    // profiles can taper to nothing over that sample instead of stopping with a cut
    const grow = rg => rg.map(([i0, c]) => (r.closed || i0 > 0) && c < r.n ? [r.closed ? (i0 - 1 + r.n) % r.n : i0 - 1, c + 1] : [i0, c]);
    // surface
    const all = [[0, r.closed ? r.n + 1 : r.n]];
    // where a ramp lies on the loop, keep its surface just under the loop's: the two splines differ by
    // a few cm, which showed as a lip and the ramp's lane lines printed over the loop's
    const sink = new Float32Array(r.n);
    if (!isRing && net.ring) for (let i = 0; i < r.n; i++) {
      for (const o of [-hw + 0.3, 0, hw - 0.3]) {
        net.surfacesAt(r.px[i] - r.tz[i] * o, r.pz[i] + r.tx[i] * o, r.py[i], 1.0, 0, res);
        const q = res.find(q2 => q2.r === net.ring);
        if (q) sink[i] = Math.max(-0.12, Math.min(sink[i], q.y - r.py[i] - 0.02));
      }
    }
    const road = sweep(r, [[-hw, i => sink[i]], [hw, i => sink[i]]], all, { uScale: 20, vScale: 1 });
    // fix UVs: u across road
    const uvs = road.attributes.uv;
    for (let k = 0; k < uvs.count; k += 2) {
      const vAlong = uvs.getX(k);
      uvs.setXY(k, 0, vAlong);
      uvs.setXY(k + 1, 1, vAlong);
    }
    const roadMesh = new THREE.Mesh(road, isRing ? this.mats.ring : r.kind === 'lot' ? this.mats.lot : this.mats.link);
    roadMesh.receiveShadow = true;
    this.root.add(roadMesh);
    // deck sides + underside (height-dependent)
    const bottom = i => {
      const y = r.py[i];
      if (y <= 5) return -(y + 0.3);
      return -lerp(y + 0.3, 1.8, Math.min(1, (y - 5) / 2));
    };
    const deckRanges = rangesWhere(r, i => !tunnelPred(i));
    const deck = sweep(r, [[-hw - 0.05, 0], [-hw - 0.05, bottom], [hw + 0.05, bottom], [hw + 0.05, 0]], deckRanges, { uScale: 8, vScale: 8 });
    if (deck) this.root.add(new THREE.Mesh(deck, this.mats.deck));
    // parapets
    for (const sg of [-1, 1]) {
      const open = sg < 0 ? openL : openR;
      const gap = sg < 0 ? gapL : gapR;
      // where another deck continues past this edge (a ramp peeling off or joining), the parapet
      // ramps down to the deck over one sample, like the sloped end of a concrete barrier
      const h = i => (open[i] ? 0 : 1);
      const rg = grow(rangesWhere(r, i => !open[i] && !tunnelPred(i)));
      const o0 = sg * (hw - 0.4), o1 = sg * hw;
      const g = sweep(r, [[o0, 0], [o0, i => 1.05 * h(i)], [o1, i => 1.05 * h(i)], [o1, 0]], rg, { uScale: 6, vScale: 3 });
      if (g) this.root.add(new THREE.Mesh(g, this.mats.concrete));
      const rail = sweep(r, [[sg * (hw - 0.3), i => 1.05 * h(i)], [sg * (hw - 0.3), i => 1.3 * h(i)], [sg * (hw - 0.1), i => 1.3 * h(i)], [sg * (hw - 0.1), i => 1.05 * h(i)]], rg, { uScale: 6, vScale: 3 });
      if (rail) this.root.add(new THREE.Mesh(rail, this.mats.rail));
      // gore infill: where the decks part, the narrow V between them is floored (just below the
      // neighbour's surface, so it never z-fights) and closed underneath, until the gap opens up
      const fw = i => (Number.isFinite(gap[i]) ? Math.min(gap[i] + 0.4, 3.0) : 0);
      const fr = grow(rangesWhere(r, i => Number.isFinite(gap[i]) && !tunnelPred(i)));
      const fill = sweep(r, [[sg * hw, -0.03], [i => sg * (hw + fw(i)), -0.03], [i => sg * (hw + fw(i)), bottom], [sg * hw, bottom]], fr, { uScale: 8, vScale: 8 });
      if (fill) this.root.add(new THREE.Mesh(fill, this.mats.gore));
      // sound walls downtown
      const swPred = i => !open[i] && !tunnelPred(i) && this._soundWallAt(r, i);
      // (drop the trailing sample rangesWhere adds, so the glass stops square instead of leaning over the opening)
      const sw = rangesWhere(r, swPred).map(([i0, c]) => (c > 2 && c < r.n ? [i0, c - 1] : [i0, c]));
      const wg = sweep(r, [[sg * (hw - 0.15), 1.3], [sg * (hw - 0.15), 4.2], [sg * (hw - 0.9), 5.0]], sw, { uScale: 6, vScale: 3 });
      if (wg) {
        const m = new THREE.Mesh(wg, this.mats.soundwall);
        m.renderOrder = 3;
        this.root.add(m);
        const frame = sweep(r, [[sg * (hw - 0.12), 4.1], [sg * (hw - 0.12), 4.3]], sw, {});
        if (frame) this.root.add(new THREE.Mesh(frame, this.mats.steel));
      }
    }
    // median barrier
    if (r.median) {
      const gapPred = i => !r.inMedianGap(i * r.ds);
      const rg = rangesWhere(r, gapPred);
      const g = sweep(r, [[-0.35, 0], [-0.24, 0.3], [-0.12, 0.9], [0.12, 0.9], [0.24, 0.3], [0.35, 0]], rg, { uScale: 6, vScale: 1 });
      if (g) this.root.add(new THREE.Mesh(g, this.mats.concrete));
      // antiglare fins on top (instanced)
      this._fins(r, rg);
      // amber flashers at the gaps
      // (set 1 m back onto the wall ends, so they sit on the barrier and never over the gap)
      for (const [s0, s1] of r.medianGaps) for (const s of [s0 - 1, s1 + 1]) this._flasher(r, s);
    }
    // tunnels
    for (const [i0, c] of tRanges) {
      const i1 = i0 + c;
      const ex = 3; // extend over the portal
      const a = Math.max(0, i0 - ex), cnt = c + ex * 2;
      const inner = sweep(r, [[-hw - 0.3, -0.2], [-hw - 0.3, 5.2], [-hw + 2.5, 6.8], [hw - 2.5, 6.8], [hw + 0.3, 5.2], [hw + 0.3, -0.2]], [[a, cnt]], { uScale: 8, vScale: 8 });
      this.root.add(new THREE.Mesh(inner, this.mats.tunnel));
      const outer = sweep(r, [[-hw - 1.3, -0.5], [-hw - 1.3, 7.8], [hw + 1.3, 7.8], [hw + 1.3, -0.5]], [[a, cnt]], {});
      this.root.add(new THREE.Mesh(outer, this.mats.tunnelOut));
      this._portal(r, a, 1);
      this._portal(r, (a + cnt - 1) % r.n, -1);
      // tunnel lamps: continuous strip each side + pools
      for (let k = 0; k < cnt; k += 2) {
        const i = (a + k) % r.n;
        for (const sg of [-1, 1]) this._tunnelLight(r, i, sg);
        if (k % 10 === 0) {
          const P = this._pt(r, i, 0);
          this.lamps.push({ x: P.x, y: P.y + 6, z: P.z, color: TUNNEL, tunnel: true, range: 40 });
        }
        if (k % 4 === 0) for (const sg of [-1, 1]) this._pool(r, i, sg * (hw - 5), TUNNEL, 0.1, 12);
      }
      void i1;
    }
    // (no crash cushions: links blend straight into the loop, so their ends are live lanes)
    if (r.kind === 'lot') this._lotDressing(r);
  }

  // parking bay: stall lines and the walls closing both ends (the aisle side stays open)
  _lotDressing(r) {
    const bay = this.net.pa.bays.find(b => b.lot === r);
    const geos = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const put = (g, s, off, dy, yawAdd = 0) => {
      const P = r.pointAt(s, off);
      e.set(0, Math.atan2(P.tx, P.tz) + yawAdd, 0); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(P.x, P.y + dy, P.z), q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m4);
      return g.toNonIndexed();
    };
    const mid = (bay.back + bay.front) / 2, D = Math.abs(bay.back - bay.front);
    // dividers (across the bay) between stalls, plus the ends
    for (let k = 0; k <= bay.n; k++) {
      const g = new THREE.PlaneGeometry(D, 0.13); g.rotateX(-Math.PI / 2);
      geos.push(put(g, bay.s0 + k * this.net.pa.stallW, mid, 0.012));
    }
    // front line along the stall mouths
    const span = bay.n * this.net.pa.stallW;
    const fl = new THREE.PlaneGeometry(0.13, span); fl.rotateX(-Math.PI / 2);
    geos.push(put(fl, bay.s0 + span / 2, bay.front, 0.012));
    this.root.add(new THREE.Mesh(mergeGeometries(geos), this.mats.paint));
    // walkway behind the stalls: lighter concrete, with a curb line where the stalls begin
    const ww = Math.abs(bay.wall - bay.back);
    const walk = new THREE.PlaneGeometry(ww, r.len - 0.8); walk.rotateX(-Math.PI / 2);
    const wm = new THREE.Mesh(put(walk, r.len / 2, (bay.wall + bay.back) / 2, 0.01), this.mats.walk);
    this.root.add(wm);
    const curb = new THREE.PlaneGeometry(0.18, r.len - 0.8); curb.rotateX(-Math.PI / 2);
    this.root.add(new THREE.Mesh(put(curb, r.len / 2, bay.back, 0.014), this.mats.paint));
    // end walls: parapet + a face down to the deck underside, from the back wall to the aisle edge
    const walls = [];
    const inner = -r.outer * (r.hw - 1.0); // where the access road begins
    const w = Math.abs(r.outer * r.hw - inner), c = (r.outer * r.hw + inner) / 2;
    const rails = [];
    for (const sEnd of [0.2, r.len - 0.2]) {
      walls.push(put(new THREE.BoxGeometry(w, 1.05 + 1.8, 0.4), sEnd, c, (1.05 - 1.8) / 2));
      rails.push(put(new THREE.BoxGeometry(w, 0.25, 0.2), sEnd, c, 1.175));
    }
    this.root.add(new THREE.Mesh(mergeGeometries(walls), this.mats.concrete));
    this.root.add(new THREE.Mesh(mergeGeometries(rails), this.mats.rail));
  }

  _soundWallAt(r, i) {
    const x = r.px[i], z = r.pz[i];
    if (r.kind === 'ring') return (x > 1350 && z > -650 && z < 800) || (x < -1500 && z > 200 && z < 800);
    return Math.abs(x) < 900 && r.py[i] > 12;
  }

  _pt(r, i, off) {
    return { x: r.px[i] - r.tz[i] * off, y: r.py[i], z: r.pz[i] + r.tx[i] * off };
  }

  _fins(r, ranges) {
    if (!this._finList) this._finList = [];
    for (const [i0, c] of ranges) for (let k = 0; k < c; k += 1) {
      const i = (i0 + k) % r.n;
      if (r.py[i] < 4.2 && r.kind === 'ring') continue;
      // no fins over the U-turn gaps (the median wall stops there; they would float over the lanes)
      const s = i * r.ds;
      if (r.medianGaps.some(([s0, s1]) => s > s0 - 2 && s < s1 + 2)) continue;
      this._finList.push([r.px[i], r.py[i] + 0.9, r.pz[i], Math.atan2(r.tx[i], r.tz[i])]);
    }
  }

  _flasher(r, s) {
    if (!this._flashers) this._flashers = [];
    for (const sg of [-1, 1]) {
      const P = r.pointAt(s, sg * 0.5);
      this._flashers.push(new THREE.Vector3(P.x, P.y + 1.1, P.z));
    }
  }

  _portal(r, i, dir) {
    const hw = r.hw;
    const g = new THREE.BoxGeometry(hw * 2 + 4, 3, 1.6);
    const m = new THREE.Mesh(g, this.mats.concrete);
    const P = this._pt(r, i, 0);
    m.position.set(P.x, P.y + 7.2, P.z);
    m.rotation.y = Math.atan2(r.tx[i], r.tz[i]);
    this.root.add(m);
    void dir;
  }

  _tunnelLight(r, i, sg) {
    if (!this._tl) this._tl = [];
    const P = this._pt(r, i, sg * (r.hw - 0.2));
    this._tl.push([P.x, P.y + 5.0, P.z, Math.atan2(r.tx[i], r.tz[i])]);
  }

  _pool(r, i, off, color, strength, size) {
    if (!this._pools) this._pools = [];
    const P = this._pt(r, i, off);
    this._pools.push({ x: P.x, y: P.y + 0.04, z: P.z, yaw: Math.atan2(r.tx[i], r.tz[i]), slope: r.sl[i], color: color.clone().multiplyScalar(strength), size });
  }

  _cushion(r, i, off) {
    if (!this._cush) this._cush = [];
    const P = this._pt(r, i, off);
    this._cush.push(P);
  }

  // ---------------------------------------------------------------- pillars
  _pillars() {
    const net = this.net;
    const mats = [];
    const res = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const addBox = (x, y, z, sx, sy, sz, yaw) => {
      e.set(0, yaw, 0);
      q.setFromEuler(e);
      p.set(x, y, z);
      s.set(sx, sy, sz);
      m4.compose(p, q, s);
      mats.push(m4.clone());
    };
    const bridge = this._bridgeRange();
    for (const r of net.ribbons) {
      const step = Math.round(38 / r.ds);
      for (let i = 0; i < r.n; i += step) {
        const y = r.py[i];
        if (y < 6.5) continue;
        const sOn = i * r.ds;
        if (r.kind === 'ring' && bridge && sOn > bridge.t0 && sOn < bridge.t1) continue;
        const yaw = Math.atan2(r.tx[i], r.tz[i]);
        const cols = r.kind === 'ring' ? [-7, 7] : [0];
        let ok = true;
        const top = y - 1.8;
        for (const off of cols) {
          const P = this._pt(r, i, off);
          // anything underneath?
          for (let hy = 1; hy < top - 2; hy += 3) {
            net.surfacesAt(P.x, P.z, hy, 1.6, 2.5, res);
            if (res.some(q2 => q2.r !== r)) { ok = false; break; }
          }
          if (!ok) break;
        }
        if (!ok) continue;
        const inWater = r.pz[i] > 1150;
        for (const off of cols) {
          const P = this._pt(r, i, off);
          const b = inWater ? -1.2 : 0;
          addBox(P.x, (top + b) / 2, P.z, 1.9, top - b, 1.9, yaw);
        }
        const C = this._pt(r, i, 0);
        // cap beam: local x is across the road after the yaw rotation
        addBox(C.x, top - 0.7, C.z, r.hw * 2 - 1.5, 1.4, 2.4, yaw);
      }
    }
    const g = new THREE.BoxGeometry(1, 1, 1);
    const im = new THREE.InstancedMesh(g, this.mats.pillar, mats.length);
    mats.forEach((m, k) => im.setMatrixAt(k, m));
    im.instanceMatrix.needsUpdate = true;
    this.root.add(im);
    // median fins
    if (this._finList) {
      const fg = new THREE.BoxGeometry(0.04, 0.55, 0.16);
      fg.translate(0, 0.27, 0);
      const fm = new THREE.InstancedMesh(fg, new THREE.MeshStandardMaterial({ color: 0x1f3a31, roughness: 0.7 }), this._finList.length);
      this._finList.forEach(([x, y, z, yaw], k) => {
        e.set(0, yaw + 0.5, 0); q.setFromEuler(e); m4.compose(p.set(x, y, z), q, s.set(1, 1, 1)); fm.setMatrixAt(k, m4);
      });
      this.root.add(fm);
    }
    // crash cushions
    if (this._cush) {
      const cg = new THREE.CylinderGeometry(0.45, 0.45, 1.0, 12);
      cg.translate(0, 0.5, 0);
      const cm = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: 0xf2c21a, roughness: 0.5, emissive: 0x3a2a00 }), this._cush.length * 3);
      let k = 0;
      for (const P of this._cush) for (let j = 0; j < 3; j++) {
        m4.makeTranslation(P.x + (j - 1) * 0.9, P.y, P.z);
        cm.setMatrixAt(k++, m4);
      }
      this.root.add(cm);
    }
  }

  _bridgeRange() {
    if (this._br !== undefined) return this._br;
    const r = this.net.ring;
    let t0 = -1, t1 = -1;
    for (let i = 0; i < r.n; i++) if (r.py[i] > 24 && r.pz[i] > 1150) { if (t0 < 0) t0 = i * r.ds; t1 = i * r.ds; }
    this._br = t0 < 0 ? null : { t0, t1, mid: (t0 + t1) / 2 };
    return this._br;
  }

  // ---------------------------------------------------------------- lamps
  _lampsBuild() {
    const poles = [], heads = [];
    const e = new THREE.Euler(), q = new THREE.Quaternion(), m4 = new THREE.Matrix4();
    for (const r of this.net.ribbons) {
      const spacing = r.kind === 'ring' ? 25 : r.kind === 'lot' ? 13 : 45;
      const step = Math.max(1, Math.round(spacing / r.ds));
      let k = 0;
      for (let i = 0; i < r.n; i += step, k++) {
        if (r.kind === 'ring' && r.py[i] < 4.2) continue;
        const sg = r.kind === 'lot' ? r.outer : (k % 2 ? 1 : -1);
        if ((sg < 0 ? r.openL : r.openR)[i]) continue;
        const x0 = r.px[i], z0 = r.pz[i];
        const white = r.kind !== 'ring' || x0 > -300 || r.py[i] > 20;
        const col = white ? LED : SODIUM;
        const base = this._pt(r, i, sg * (r.hw - 0.2));
        const head = this._pt(r, i, sg * (r.hw - 3.0));
        // a pole must not stand in, or poke up through, another carriageway: skip it when any other
        // road surface lies within its height span (plus a margin) above the base or the lamp head
        const blocked = [base, head].some(p => this.net.surfacesAt(p.x, p.z, p.y + 6, 7, 1.5, []).some(q => q.r !== r && q.y > p.y - 0.5 && q.y < p.y + 12));
        if (blocked) continue;
        const yaw = Math.atan2(r.tx[i], r.tz[i]);
        poles.push({ x: base.x, y: base.y, z: base.z, yaw, sg });
        heads.push({ x: head.x, y: head.y + 10.35, ry: head.y, z: head.z, yaw, col });
        this.lamps.push({ x: head.x, y: head.y + 10.1, z: head.z, color: col, range: 42 });
        this._pool(r, i, sg * (r.hw - 4.5), col, white ? 0.14 : 0.17, 18);
      }
    }
    // pole geometry: vertical + arm (merged), instanced
    const pv = new THREE.CylinderGeometry(0.13, 0.18, 9.6, 6);
    pv.translate(0, 4.8, 0);
    const arm = new THREE.BoxGeometry(0.12, 0.12, 3.0);
    arm.rotateY(Math.PI / 2);
    arm.translate(-1.4, 9.55, 0);
    const poleGeo = mergeGeometries([pv.toNonIndexed(), arm.toNonIndexed()]);
    const pm = new THREE.InstancedMesh(poleGeo, this.mats.steel, poles.length);
    poles.forEach((P, k) => {
      // arm points toward the road center: local -x should map to -sg*right
      const yaw = P.yaw + (P.sg > 0 ? Math.PI : 0);
      e.set(0, yaw, 0); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(P.x, P.y + 1.05, P.z), q, new THREE.Vector3(1, 1, 1));
      pm.setMatrixAt(k, m4);
    });
    this.root.add(pm);
    const hg = new THREE.BoxGeometry(0.5, 0.14, 1.1);
    const hm = new THREE.InstancedMesh(hg, new THREE.MeshBasicMaterial({ color: 0xffffff }), heads.length);
    heads.forEach((H, k) => {
      e.set(0, H.yaw, 0); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(H.x, H.y, H.z), q, new THREE.Vector3(1, 1, 1));
      hm.setMatrixAt(k, m4);
      hm.setColorAt(k, H.col.clone().multiplyScalar(1.05));
    });
    this.root.add(hm);
    this.lampHeads = heads;
    // pools
    const pg = new THREE.PlaneGeometry(1, 1);
    pg.rotateX(-Math.PI / 2);
    this.poolMat = new THREE.MeshBasicMaterial({ map: this.tex.pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
    const pools = this._pools || [];
    const pim = new THREE.InstancedMesh(pg, this.poolMat, pools.length);
    pools.forEach((P, k) => {
      e.set(-Math.atan(P.slope), P.yaw, 0, 'YXZ'); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(P.x, P.y, P.z), q, new THREE.Vector3(P.size, 1, P.size * 1.2));
      pim.setMatrixAt(k, m4);
      pim.setColorAt(k, P.color);
    });
    pim.renderOrder = 1;
    this.poolMesh = pim;
    this.root.add(pim);
    // tunnel strip lights
    if (this._tl) {
      const tg = new THREE.BoxGeometry(0.35, 0.18, 1.5);
      const tm = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb458').multiplyScalar(1.4) }), this._tl.length);
      this._tl.forEach(([x, y, z, yaw], k) => { e.set(0, yaw, 0, 'XYZ'); q.setFromEuler(e); m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)); tm.setMatrixAt(k, m4); });
      this.root.add(tm);
    }
    // flashers (amber, animated)
    if (this._flashers) {
      const fg = new THREE.SphereGeometry(0.22, 8, 6);
      this.flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffa020').multiplyScalar(1.6) });
      const fm = new THREE.InstancedMesh(fg, this.flashMat, this._flashers.length);
      this._flashers.forEach((v, k) => { m4.makeTranslation(v.x, v.y, v.z); fm.setMatrixAt(k, m4); });
      this.root.add(fm);
    }
    // static reflection streaks under lamp heads
    this.lampStreaks = new Streaks(heads.length);
    this.lampStreaks.begin();
    for (const H of heads) this.lampStreaks.push(H.x, H.ry + 0.08, H.z, H.col, 0.9, 9);
    this.lampStreaks.end();
    this.root.add(this.lampStreaks.mesh);
  }

  // ---------------------------------------------------------------- signs
  _signs() {
    const net = this.net, ring = net.ring;
    const steel = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const box = (x, y, z, sx, sy, sz, yaw) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      e.set(0, yaw, 0); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m4);
      steel.push(g.toNonIndexed());
    };
    const gantry = (r, s, dir, tex, vms) => {
      // the median leg stands on the median wall: move the gantry clear of the U-turn gaps where the wall stops
      if (r.median) for (const [g0, g1] of r.medianGaps) if (s > g0 - 15 && s < g1 + 15) s = g1 + 25;
      const P = r.pointAt(s, 0);
      const i = P.i;
      if ((dir > 0 ? r.openL : r.openR)[i]) return;
      if (r.kind === 'ring' && P.y < 4.2) return;
      const sg = r.kind === 'ring' ? -dir : 0;
      const yaw = Math.atan2(P.tx, P.tz);
      // ring: inner leg on the median wall centre (the fast lane starts 1.1 m out), never in the lane
      const inner = r.kind === 'ring' ? 0 : -r.hw + 0.3;
      const outer = r.kind === 'ring' ? sg * (r.hw - 0.3) : r.hw - 0.3;
      for (const off of [inner, outer]) {
        const Q = r.pointAt(s, off);
        box(Q.x, Q.y + 3.9, Q.z, 0.35, 7.8, 0.35, yaw);
      }
      const mid = (inner + outer) / 2, span = Math.abs(outer - inner);
      const M = r.pointAt(s, mid);
      const beamYaw = yaw;
      box(M.x, M.y + 7.7, M.z, span, 0.35, 0.35, beamYaw);
      box(M.x, M.y + 6.9, M.z, span, 0.2, 0.2, beamYaw);
      const w = Math.min(span - 1.2, 9), h = vms ? 1.5 : 2.8;
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: true });
      mat.color.setScalar(vms ? 1.8 : 0.85);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      // faces drivers: normal = -travel direction
      pl.rotation.y = yaw + (dir > 0 ? Math.PI : 0);
      const back = pl.clone();
      back.material = this.mats.steel;
      pl.position.set(M.x - P.tx * dir * 0.25, M.y + 7.4 + h / 2 - (vms ? 0.6 : 0.9), M.z - P.tz * dir * 0.25);
      back.position.set(M.x, pl.position.y, M.z);
      back.rotation.y = pl.rotation.y + Math.PI;
      this.root.add(pl, back);
    };
    const signs = [
      TX.signTexture([{ text: 'K1  環状線', size: 56 }, { text: 'Loop  ↑', size: 44 }]),
      TX.signTexture([{ text: 'C2  中央連絡線', size: 48 }, { text: 'Central Link  ↖  1 km', size: 38 }]),
      TX.signTexture([{ text: '湾岸  Bayshore', size: 50 }, { text: 'Kaigan Bridge  ↑', size: 40 }]),
      TX.signTexture([{ text: '北トンネル', size: 54 }, { text: 'Kita Tunnel  2 km', size: 40 }]),
      TX.signTexture([{ text: '汐留  Shiodome', size: 50 }, { text: 'Downtown  ↑', size: 40 }]),
    ];
    const vms = [TX.vmsTexture('夜間走行注意  ·  DRIVE SAFE'), TX.vmsTexture('K1 LOOP  10.5 km  ·  流れは順調'), TX.vmsTexture('ライト点灯  ·  LIGHTS ON')];
    const L = ring.len;
    let k = 0;
    for (let s = 150; s < L - 100; s += 700, k++) {
      gantry(ring, s, 1, (k % 3 === 1) ? vms[k % vms.length] : signs[k % signs.length], k % 3 === 1);
      gantry(ring, wrap(s + 350, L), -1, (k % 3 === 2) ? vms[(k + 1) % vms.length] : signs[(k + 2) % signs.length], k % 3 === 2);
    }
    // parking area ahead
    if (net.pa) gantry(ring, wrap(net.pa.sExit - 380, L), 1, TX.signTexture([{ text: '西PA  Nishi PA', size: 52 }, { text: 'P  Parking  ↗  400 m', size: 40 }]), false);
    // exit signs before diverges
    for (const d of net.links.diverge) gantry(d.from, wrap(d.s0 - d.dir * 700, d.from.len), d.dir, signs[1], false);
    for (const r of net.ribbons) if (r.kind === 'link') { gantry(r, 400, 1, signs[4], false); gantry(r, r.len * 0.5, 1, vms[0], true); gantry(r, r.len - 500, 1, signs[0], false); }
    if (steel.length) this.root.add(new THREE.Mesh(mergeGeometries(steel), this.mats.steel));
  }

  // ---------------------------------------------------------------- bridge
  _bridge() {
    const br = this._bridgeRange();
    if (!br) return;
    const r = this.net.ring;
    const mid = br.mid, half = 250, anchor = 520;
    const deckAt = s => r.pointAt(s, 0).y;
    const towerTop = deckAt(mid) + 72;
    const white = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.5, metalness: 0.2, emissive: 0x2a3140, emissiveIntensity: 0.6 });
    const parts = [];
    const lights = [];
    for (const ts of [mid - half, mid + half]) {
      const P = r.pointAt(ts, 0);
      const yaw = Math.atan2(P.tx, P.tz);
      for (const sg of [-1, 1]) {
        const Q = r.pointAt(ts, sg * (r.hw + 2.2));
        const g = new THREE.BoxGeometry(3.2, towerTop + 1.2, 4.2);
        g.translate(0, (towerTop - 1.2) / 2, 0);
        g.rotateY(yaw);
        g.translate(Q.x, 0, Q.z);
        parts.push(g.toNonIndexed());
        lights.push(new THREE.Vector3(Q.x, towerTop + 1.5, Q.z));
      }
      for (const hy of [P.y - 3, towerTop - 8, towerTop - 30]) {
        const g = new THREE.BoxGeometry(r.hw * 2 + 7, 2.4, 3);
        g.rotateY(yaw);
        g.translate(P.x, hy, P.z);
        parts.push(g.toNonIndexed());
      }
    }
    this.root.add(new THREE.Mesh(mergeGeometries(parts), white));
    // cables + suspenders + cable lights
    const cableMat = new THREE.MeshStandardMaterial({ color: 0xcfd6e0, roughness: 0.4, metalness: 0.6 });
    const lightPts = [], lightCols = [];
    const lines = [];
    for (const sg of [-1, 1]) {
      const pts = [];
      for (let s = mid - anchor; s <= mid + anchor; s += 10) {
        const P = r.pointAt(s, sg * (r.hw + 2.2));
        const d = Math.abs(s - mid);
        let y;
        if (d <= half) y = deckAt(s) + 10 + (towerTop - deckAt(mid) - 10) * Math.pow(d / half, 2);
        else y = lerp(towerTop, deckAt(s) + 1.5, (d - half) / (anchor - half));
        pts.push(new THREE.Vector3(P.x, y, P.z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      this.root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 2, 0.45, 6, false), cableMat));
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k];
        const s = mid - anchor + k * 10;
        const E = r.pointAt(s, sg * (r.hw + 1.0));
        lines.push(p.x, p.y, p.z, E.x, E.y + 1.2, E.z);
        if (k % 1 === 0) { lightPts.push(p.x, p.y + 0.6, p.z); lightCols.push(0.85, 0.92, 1.0); }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.root.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x8894a8, transparent: true, opacity: 0.6 })));
    this._addPoints(lightPts, lightCols, 3.5);
    const red = [];
    for (const v of lights) red.push(v.x, v.y, v.z);
    this._addBlinkers(red);
  }

  _addPoints(pos, col, size) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size, map: this.tex.glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    m.color.setScalar(1.0);
    const p = new THREE.Points(g, m);
    this.root.add(p);
    return p;
  }

  _addBlinkers(pos) {
    if (!this.blinkPos) this.blinkPos = [];
    this.blinkPos.push(...pos);
  }

  // ---------------------------------------------------------------- landmarks
  _landmarks() {
    const net = this.net;
    // lattice tower
    {
      const cx = -700, cz = -620, H = 250;
      const segs = [];
      const levels = 26;
      const halfW = y => lerp(30, 3, Math.pow(y / H, 0.7));
      for (let l = 0; l < levels; l++) {
        const y0 = (l / levels) * H, y1 = ((l + 1) / levels) * H;
        const w0 = halfW(y0), w1 = halfW(y1);
        const c0 = [[-w0, -w0], [w0, -w0], [w0, w0], [-w0, w0]];
        const c1 = [[-w1, -w1], [w1, -w1], [w1, w1], [-w1, w1]];
        for (let k = 0; k < 4; k++) {
          const a = c0[k], b = c0[(k + 1) % 4], a1 = c1[k], b1 = c1[(k + 1) % 4];
          segs.push(cx + a[0], y0, cz + a[1], cx + a1[0], y1, cz + a1[1]);
          segs.push(cx + a[0], y0, cz + a[1], cx + b1[0], y1, cz + b1[1]);
          segs.push(cx + b[0], y0, cz + b[1], cx + a1[0], y1, cz + a1[1]);
          segs.push(cx + a1[0], y1, cz + a1[1], cx + b1[0], y1, cz + b1[1]);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      const lm = new THREE.LineBasicMaterial({ color: new THREE.Color('#ff7a2a').multiplyScalar(1.6) });
      this.root.add(new THREE.LineSegments(g, lm));
      for (const [y, w] of [[H * 0.36, 24], [H * 0.62, 14]]) {
        const d = new THREE.Mesh(new THREE.BoxGeometry(w, 7, w), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(1.3) }));
        d.position.set(cx, y, cz);
        this.root.add(d);
      }
      const pts = [], cols = [];
      for (let l = 0; l <= levels; l += 1) {
        const y = (l / levels) * H, w = halfW(y);
        for (const [a, b] of [[-w, -w], [w, -w], [w, w], [-w, w]]) { pts.push(cx + a, y, cz + b); cols.push(1, 0.6, 0.3); }
      }
      this._addPoints(pts, cols, 6);
      this._addBlinkers([cx, H + 2, cz]);
    }
    // ferris wheel
    {
      const cx = 1000, cz = 900, R = 55, cy = 64;
      const grp = new THREE.Group();
      grp.position.set(cx, cy, cz);
      grp.rotation.y = 0.5;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.6, 6, 80), this.mats.steel);
      grp.add(ring);
      const spokes = [];
      const N = 36;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        spokes.push(0, 0, 0, Math.cos(a) * R, Math.sin(a) * R, 0);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(spokes, 3));
      grp.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0x9aa6c0 })));
      const lp = [], lc = [];
      for (let k = 0; k < 144; k++) {
        const a = (k / 144) * Math.PI * 2;
        lp.push(Math.cos(a) * R, Math.sin(a) * R, 0);
        lc.push(1, 1, 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
      const pm = new THREE.PointsMaterial({ size: 5, map: this.tex.glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const pts = new THREE.Points(g, pm);
      grp.add(pts);
      this.wheelColors = g.attributes.color;
      this.wheel = grp;
      // legs
      const leg = new THREE.BoxGeometry(1.2, cy, 1.2);
      for (const [sx, a] of [[1, 0.3], [-1, -0.3]]) {
        const m = new THREE.Mesh(leg, this.mats.steel);
        m.position.set(cx + Math.sin(0.5) * sx * 8, cy / 2, cz + Math.cos(0.5) * sx * 8);
        m.rotation.z = a;
        this.root.add(m);
      }
      this.root.add(grp);
    }
    // harbor cranes (west shore, outside the loop)
    {
      const red = new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.6, emissive: 0x200404 });
      const parts = [];
      for (let k = 0; k < 4; k++) {
        const x = -2250 - k * 130, z = 1120;
        for (const dx of [-8, 8]) for (const dz of [-6, 6]) {
          const g = new THREE.BoxGeometry(1.2, 42, 1.2); g.translate(x + dx, 21, z + dz); parts.push(g.toNonIndexed());
        }
        const beam = new THREE.BoxGeometry(3, 3, 95); beam.translate(x, 44, z + 20); parts.push(beam.toNonIndexed());
        const cab = new THREE.BoxGeometry(18, 6, 14); cab.translate(x, 40, z); parts.push(cab.toNonIndexed());
        this._addBlinkers([x, 47, z + 66, x, 47, z - 26]);
      }
      this.root.add(new THREE.Mesh(mergeGeometries(parts), red));
    }
    void net;
  }

  // ---------------------------------------------------------------- city
  _city() {
    const net = this.net;
    const R = rng(1234);
    const inst = [];
    const districts = [
      { x: 350, z: -150, r: 1100, hMin: 45, hMax: 230 },
      { x: 1500, z: 250, r: 700, hMin: 30, hMax: 150 },
      { x: -1100, z: 450, r: 700, hMin: 20, hMax: 90 },
    ];
    const heightAt = (x, z) => {
      let hmax = 12 + 20 * R(), hmin = 8;
      for (const d of districts) {
        const f = Math.max(0, 1 - Math.hypot(x - d.x, z - d.z) / d.r);
        hmax = Math.max(hmax, lerp(hmax, d.hMax, f * f));
        hmin = Math.max(hmin, d.hMin * f);
      }
      const dist = Math.hypot(x, z * 1.3);
      if (dist > 2600) hmax *= 0.6;
      return lerp(hmin, hmax, Math.pow(R(), 1.6));
    };
    const step = 52;
    for (let gx = -3600; gx <= 3600; gx += step) {
      for (let gz = -3200; gz <= 1100; gz += step) {
        const x = gx + (R() - 0.5) * 16, z = gz + (R() - 0.5) * 16;
        if (z > 1080) continue;
        // park around the tunnel & tower plaza
        if (z < -1000 && z > -1500 && x > -800 && x < 900) continue;
        if (Math.hypot(x + 700, z + 620) < 70) continue;
        if (Math.hypot(x - 1000, z - 900) < 90) continue;
        const industrial = x < -1450 && z > 500;
        const w = industrial ? 30 + R() * 40 : 16 + R() * 26, d = industrial ? 24 + R() * 30 : 16 + R() * 26;
        // draw everything first (a fixed count per cell), decide afterwards
        const gapCell = R() < 0.12;
        const hRand = industrial ? 10 + R() * 14 : heightAt(x, z);
        const seed = R(), tintR = R(), towerR = R(), towerH = R(), towerSeed = R();
        if (!net.clearance(x, z, Math.max(w, d) * 0.72 + 9) || gapCell) continue;
        const h = hRand;
        const tint = industrial ? [0.35, 0.3, 0.25] : [[0.5, 0.55, 0.7], [0.6, 0.5, 0.45], [0.45, 0.6, 0.65], [0.7, 0.65, 0.6], [0.4, 0.45, 0.55]][Math.floor(tintR * 5)];
        inst.push({ x, z, w, d, h, seed, tint });
        if (h > 60 && towerR < 0.35) inst.push({ x, z, w: w * 0.6, d: d * 0.6, h: h + 10 + towerH * 25, seed: towerSeed, tint });
      }
    }
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    const seeds = new Float32Array(inst.length), tints = new Float32Array(inst.length * 3);
    this.buildingMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uLit: { value: 1 } }]),
      vertexShader: buildingVert, fragmentShader: buildingFrag, fog: true,
    });
    const im = new THREE.InstancedMesh(g, this.buildingMat, inst.length);
    const m4 = new THREE.Matrix4();
    inst.forEach((b, k) => {
      m4.makeScale(b.w, b.h, b.d);
      m4.setPosition(b.x, 0, b.z);
      im.setMatrixAt(k, m4);
      seeds[k] = b.seed;
      tints[k * 3] = b.tint[0]; tints[k * 3 + 1] = b.tint[1]; tints[k * 3 + 2] = b.tint[2];
    });
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
    im.frustumCulled = false;
    this.root.add(im);
    this.buildings = inst;

    // aviation lights on tall buildings
    const tall = [];
    for (const b of inst) if (b.h > 95) tall.push(b.x, b.h + 1.5, b.z);
    this._addBlinkers(tall);
    this._blinkersBuild();

    // neon billboards near the highway
    const words = [['MECHARA', 'メカラ'], ['CarbeneX', 'カーボネックス'], ['AEROVEX', null], ['NEONDRIVE', 'ネオンドライブ'], ['ラーメン', '24H'], ['カラオケ', 'KARAOKE'], ['珈琲', 'COFFEE'], ['XCELLENT', null], ['夜景', 'NIGHT VIEW'], ['駐車場', 'PARKING P']];
    const texs = words.map((w, k) => TX.neonTexture(w[0], w[1], [330, 190, 45, 280, 15, 160, 30, 95, 210, 250][k], R));
    const res = [];
    let placed = 0;
    for (const b of inst) {
      if (placed > 70) break;
      if (b.h < 25 || R() > 0.5) continue;
      // nearest road
      let best = null;
      for (const r of net.ribbons) {
        const P = r.projectGlobal(b.x, b.z);
        if (!best || P.dist < best.dist) best = { ...P, r };
      }
      if (!best || best.dist > 110 || best.dist < 30) continue;
      const rp = best.r.pointAt(best.s, 0);
      const dx = rp.x - b.x, dz = rp.z - b.z;
      let nx = 0, nz = 0, faceOff;
      if (Math.abs(dx) / b.w > Math.abs(dz) / b.d) { nx = Math.sign(dx); faceOff = b.w / 2; } else { nz = Math.sign(dz); faceOff = b.d / 2; }
      const y = clamp(rp.y + 6 + R() * 12, 8, b.h - 6);
      if (y < 8) continue;
      const tw = Math.min(nx ? b.d : b.w, 16) * 0.85;
      const mat = new THREE.MeshBasicMaterial({ map: texs[Math.floor(R() * texs.length)] });
      mat.color.setScalar(1.25);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(tw, tw * 0.5), mat);
      pl.position.set(b.x + nx * (faceOff + 0.3), y, b.z + nz * (faceOff + 0.3));
      pl.rotation.y = Math.atan2(nx, nz);
      this.root.add(pl);
      placed++;
      void res;
    }
    // park trees
    const trees = [];
    for (let k = 0; k < 900; k++) {
      const x = -800 + R() * 1700, z = -1500 + R() * 500;
      if (!net.clearance(x, z, 6)) continue;
      trees.push([x, z, 5 + R() * 7]);
    }
    const tg = new THREE.ConeGeometry(2.6, 1, 6);
    tg.translate(0, 0.5, 0);
    const tm = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: 0x0f2418, roughness: 1 }), trees.length);
    trees.forEach(([x, z, h], k) => { m4.makeScale(1, h, 1); m4.setPosition(x, 0, z); tm.setMatrixAt(k, m4); });
    this.root.add(tm);
  }

  _blinkersBuild() {
    const pos = this.blinkPos || [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const phase = new Float32Array(pos.length / 3);
    for (let i = 0; i < phase.length; i++) phase[i] = Math.random() * 6.28;
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.blinkMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uMap: { value: this.tex.glow } }]),
      vertexShader: `attribute float aPhase; uniform float uTime; varying float vOn;
        #include <fog_pars_vertex>
        void main(){ vec4 mvPosition = modelViewMatrix * vec4(position,1.0); vOn = step(0.55, sin(uTime*2.2 + aPhase)*0.5+0.5);
        gl_PointSize = 900.0 / -mvPosition.z; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform sampler2D uMap; varying float vOn;
        #include <fog_pars_fragment>
        void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vec3(1.0,0.08,0.05)*2.5*a*(0.15+0.85*vOn), 1.0);
        #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    });
    const p = new THREE.Points(g, this.blinkMat);
    p.frustumCulled = false;
    this.root.add(p);
  }

  inTunnel(r, s) {
    const t = this.tunnels.get(r.id);
    if (!t) return false;
    for (const [a, b] of t) if (s >= a && s <= b) return true;
    return false;
  }

  update(dt, camera) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    this.groundMat.uniforms.uTime.value = this.time;
    if (this.blinkMat) this.blinkMat.uniforms.uTime.value = this.time;
    this.waterNormal.offset.x = this.time * 0.004;
    this.waterNormal.offset.y = this.time * 0.002;
    if (this.flashMat) this.flashMat.color.setScalar(Math.sin(this.time * 6) > 0 ? 1.6 : 0.15).multiply(new THREE.Color('#ffa020'));
    if (this.wheel) {
      const t = this.time;
      this.wheel.children.forEach(c => { c.rotation.z = t * 0.04; });
      const col = this.wheelColors;
      for (let k = 0; k < col.count; k++) {
        const h = (k / col.count + t * 0.05) % 1;
        const c = this._tmpC || (this._tmpC = new THREE.Color());
        c.setHSL(h, 0.9, 0.6);
        col.setXYZ(k, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    }
    this.lampStreaks.mat.uniforms.uCam.value.copy(camera.position);
  }
}
