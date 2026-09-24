// Realistic hero cars loaded from glTF (Sketchfab, CC-BY 4.0 — see the credits screen).
// Each file is normalised once into a template (facing +Z, real-world length, wheels on y = 0,
// centred between the axles). Every car on screen is a cheap clone of its template that shares
// geometry and textures; only the lamp materials are per-car so each car drives its own lights.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const templates = new Map();

export async function loadGlbCars(specs, onEach) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(specs.filter(s => s.glb).map(async s => {
    const gltf = await loader.loadAsync(s.glb.file);
    templates.set(s.id, prepare(gltf.scene, s));
    if (onEach) onEach(s);
  }));
}
export const glbReady = id => templates.has(id);

const test = (re, s) => !!re && re.test(s || '');
const matName = m => (Array.isArray(m.material) ? m.material[0] : m.material).name || '';

// Axle of a wheel mesh: the eigenvector of least variance of its world-space vertices (a tyre is a disc).
function pcaAxle(mesh) {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.attributes.position, v = new THREE.Vector3(), n = pos.count;
  const pts = new Float32Array(n * 3), mean = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); pts.set([v.x, v.y, v.z], i * 3); mean.add(v); }
  mean.divideScalar(n);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const d = [pts[i * 3] - mean.x, pts[i * 3 + 1] - mean.y, pts[i * 3 + 2] - mean.z];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b] / n;
  }
  // power iteration on (trace·I − C): its dominant eigenvector is C's smallest
  const tr = C[0][0] + C[1][1] + C[2][2];
  let x = [1, 0.31, 0.17];
  for (let it = 0; it < 120; it++) {
    const y = [0, 1, 2].map(a => tr * x[a] - (C[a][0] * x[0] + C[a][1] * x[1] + C[a][2] * x[2]));
    const l = Math.hypot(y[0], y[1], y[2]) || 1;
    x = y.map(q => q / l);
  }
  return { axle: new THREE.Vector3(x[0], x[1], x[2]), mean };
}

function prepare(scene, spec) {
  const G = spec.glb;
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(scene);
  root.add(inner);
  inner.rotation.y = G.rotY || 0;
  root.updateMatrixWorld(true);
  const drop = [];
  scene.traverse(o => { if (o.isMesh && (test(G.hide, o.name) || test(G.hideMat, matName(o)))) drop.push(o); });
  for (const o of drop) o.parent.remove(o);
  let box = new THREE.Box3().setFromObject(inner);
  const s = G.length / (box.max.z - box.min.z);
  inner.scale.setScalar(s);
  root.updateMatrixWorld(true);
  // wheels: meshes by material / node name, grouped into four corners
  const meshes = [];
  scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  box = new THREE.Box3().setFromObject(inner);
  const cz0 = (box.min.z + box.max.z) / 2;
  // reference centre for left/right: the wheels themselves (some files are off-centre or carry stray parts)
  let wx = 0, wn = 0;
  meshes.forEach(m => { if (test(G.wheel, matName(m)) || test(G.wheelNode, m.name)) { wx += new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).x; wn++; } });
  const cx0 = wn ? wx / wn : (box.min.x + box.max.x) / 2;
  const corners = new Map();
  meshes.forEach((m, i) => {
    const isWheel = test(G.wheel, matName(m)) || test(G.wheelNode, m.name);
    const isCaliper = test(G.caliper, matName(m)) || test(G.caliperNode, m.name);
    if (!isWheel && !isCaliper) return;
    const b = new THREE.Box3().setFromObject(m);
    const c = b.getCenter(new THREE.Vector3());
    const key = (c.x > cx0 ? 'L' : 'R') + (c.z > cz0 ? 'F' : 'B');
    if (!corners.has(key)) corners.set(key, { key, wheel: [], caliper: [], box: new THREE.Box3() });
    const k = corners.get(key);
    (isWheel ? k.wheel : k.caliper).push(i);
    if (isWheel) k.box.union(b);
  });
  // Each wheel spins about the car's X axis through the tyre centre. Some files ship wheels already
  // steered or tilted (the S13's fronts sit at ~25°): measure the tyre's real axle (smallest-variance
  // direction of its vertices) and straighten the whole corner about the tyre centre, so it rolls true.
  const wheels = [...corners.values()].filter(k => k.wheel.length).map(k => {
    let tyre = null, dia = 0;
    for (const i of k.wheel) {
      const s = new THREE.Box3().setFromObject(meshes[i]).getSize(new THREE.Vector3());
      const d = Math.max(s.x, s.y, s.z);
      if (d > dia) { dia = d; tyre = meshes[i]; }
    }
    const { axle, mean } = pcaAxle(tyre);
    if (axle.x < 0) axle.negate();
    const tilt = Math.acos(Math.min(1, axle.x));
    if (tilt > 0.01) {
      const q = new THREE.Quaternion().setFromUnitVectors(axle, new THREE.Vector3(1, 0, 0));
      const M = new THREE.Matrix4().makeTranslation(mean.x, mean.y, mean.z)
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
        .multiply(new THREE.Matrix4().makeTranslation(-mean.x, -mean.y, -mean.z));
      // the meshes live under `inner` (which is re-centred below): express the world rotation in its space
      const Mi = new THREE.Matrix4().copy(inner.matrixWorld).invert().multiply(M).multiply(inner.matrixWorld);
      for (const i of [...k.wheel, ...k.caliper]) { inner.attach(meshes[i]); meshes[i].applyMatrix4(Mi); }
      root.updateMatrixWorld(true);
    }
    // now axis-aligned: the tyre's bounding-box centre is its true hub (the vertex mean can be off-centre)
    const tbox = new THREE.Box3().setFromObject(tyre), tb = tbox.getSize(new THREE.Vector3());
    return { idx: k.wheel, cal: k.caliper, c: tbox.getCenter(new THREE.Vector3()), r: Math.max(tb.y, tb.z) / 2, front: k.key[1] === 'F' };
  });
  // put the tyres on the ground and centre the car between its axles
  const ground = wheels.length ? Math.min(...wheels.map(w => w.c.y - w.r)) : box.min.y;
  const zs = wheels.map(w => w.c.z);
  const midZ = zs.length ? (Math.max(...zs) + Math.min(...zs)) / 2 : cz0;
  const midX = wheels.length ? wheels.reduce((a, w) => a + w.c.x, 0) / wheels.length : cx0;
  inner.position.set(-midX, -ground, -midZ);
  root.updateMatrixWorld(true);
  for (const w of wheels) w.c.add(inner.position);
  box = new THREE.Box3().setFromObject(inner);
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = false; }
  // body paint: many exports leave paint fully metallic (glTF default) and it renders like chrome.
  // Replace it with a car-paint material: coloured base, low metalness, clear coat on top.
  const painted = new Map();
  for (const m of meshes) {
    const src = m.material;
    if (!test(G.paint || /^paint$/i, src.name)) continue;
    if (!painted.has(src)) {
      const p = new THREE.MeshPhysicalMaterial({
        name: src.name, color: src.color.clone(), map: src.map, normalMap: src.normalMap, aoMap: src.aoMap,
        metalnessMap: src.metalnessMap, roughnessMap: src.roughnessMap,
        metalness: src.metalnessMap ? 0.35 : 0.12, roughness: THREE.MathUtils.clamp(src.roughness, 0.28, 0.5),
        clearcoat: 0.75, clearcoatRoughness: 0.14, envMapIntensity: 0.85,
      });
      if (src.normalMap) p.normalScale.copy(src.normalScale);
      painted.set(src, p);
    }
    m.material = painted.get(src);
  }
  // lamp anchor points (for glow sprites): centroids of the lamp meshes per side and end
  const lampPts = (re, reNode, front) => {
    const acc = { L: [0, 0, 0, 0], R: [0, 0, 0, 0] };
    const v = new THREE.Vector3();
    for (const m of meshes) {
      if (!(test(re, matName(m)) || test(reNode, m.name))) continue;
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if ((v.z > 0) !== front) continue;
        const a = acc[v.x > 0 ? 'L' : 'R'];
        a[0] += v.x; a[1] += v.y; a[2] += v.z; a[3]++;
      }
    }
    const out = [];
    for (const k of ['L', 'R']) { const a = acc[k]; if (a[3]) out.push(new THREE.Vector3(a[0] / a[3], a[1] / a[3], a[2] / a[3])); }
    return out;
  };
  const head = G.headAt ? G.headAt.map(p => new THREE.Vector3(...p)) : lampPts(G.headPts || G.headMat, G.headNode, true);
  const tail = G.tailAt ? G.tailAt.map(p => new THREE.Vector3(...p)) : lampPts(G.tailPts || G.tailMat, G.tailNode, false);
  const size = box.getSize(new THREE.Vector3());
  // width from the wheel track (stray parts such as mirrors on a long arm must not widen the car)
  const track = wheels.length ? Math.max(...wheels.map(w => Math.abs(w.c.x))) * 2 + 0.5 : size.x;
  // Merge the static body into one mesh per material (these files carry 30-110 separate parts,
  // i.e. as many draw calls per car). Wheels, calipers and lamps stay separate: they move or light up.
  const isLamp = m => ['head', 'tail', 'rev', 'blink'].some(r => test(G[r + 'Mat'], matName(m)) || test(G[r + 'Node'], m.name));
  const keep = new Set();
  for (const w of wheels) for (const i of [...w.idx, ...w.cal]) keep.add(meshes[i]);
  for (const m of meshes) if (isLamp(m)) keep.add(m);
  const byMat = new Map();
  for (const m of meshes) {
    if (keep.has(m)) continue;
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(m);
  }
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map(m => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      // compressed files store quantised (integer) attributes: expand to float before baking transforms
      for (const k of Object.keys(g.attributes)) {
        const a = g.attributes[k];
        if (a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute) continue;
        const f = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent ? a.getComponent(i, c) : [a.getX, a.getY, a.getZ, a.getW][c].call(a, i);
        g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
      }
      g.applyMatrix4(m.matrixWorld);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      g.morphAttributes = {};
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'merged:' + (mat.name || '');
    mesh.castShadow = true;
    root.add(mesh);
    for (const m of list) m.parent.remove(m);
  }
  // wheel / caliper meshes are addressed by traversal order in each clone: recompute after merging
  const order = [];
  root.traverse(o => { if (o.isMesh) order.push(o); });
  for (const w of wheels) { w.idx = w.idx.map(i => order.indexOf(meshes[i])); w.cal = w.cal.map(i => order.indexOf(meshes[i])); }
  return { root, meshCount: order.length, wheels, head, tail, L: size.z, W: Math.min(size.x, track), H: box.max.y, box };
}

export class GlbCarModel {
  constructor(spec) {
    const T = templates.get(spec.id);
    if (!T) throw new Error('GLB car not loaded: ' + spec.id);
    const G = spec.glb;
    this.spec = spec;
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    const clone = T.root.clone(true);
    this.body.add(clone);
    this.L = T.L; this.W = T.W; this.H = T.H;
    this.group.updateMatrixWorld(true);
    const meshes = [];
    clone.traverse(o => { if (o.isMesh) meshes.push(o); });
    // wheels: pivot (steer) > spin (roll) > tyre, rim, disc; calipers steer but do not roll
    this.wheels = [];
    for (const w of T.wheels) {
      const pivot = new THREE.Group();
      pivot.position.copy(w.c);
      this.group.add(pivot);
      const spin = new THREE.Group();
      pivot.add(spin);
      pivot.updateMatrixWorld(true);
      for (const i of w.idx) spin.attach(meshes[i]);
      for (const i of w.cal) pivot.attach(meshes[i]);
      this.wheels.push({ pivot, spin, front: w.front, r: w.r });
    }
    this.wheelbase = T.wheels.length ? Math.max(...T.wheels.map(w => w.c.z)) - Math.min(...T.wheels.map(w => w.c.z)) : 2.6;
    // lamps: per-car copies of the lamp materials so brake / indicator states are independent
    const own = new Map();
    const role = (m, re, reNode) => test(re, matName(m)) || test(reNode, m.name);
    const claim = (mesh, key, color) => {
      const k = key + ':' + mesh.material.uuid;
      if (!own.has(k)) {
        const mat = mesh.material.clone();
        mat.emissive = new THREE.Color(color);
        if (!mat.emissiveMap && mat.map) mat.emissiveMap = mat.map;
        mat.emissiveIntensity = 0;
        mat.userData.role = key;
        own.set(k, mat);
      }
      mesh.material = own.get(k);
    };
    for (const m of meshes) {
      if (role(m, G.headMat, G.headNode)) claim(m, 'head', '#fff2dc');
      else if (role(m, G.tailMat, G.tailNode)) claim(m, 'tail', '#ff2030');
      else if (role(m, G.revMat, G.revNode)) claim(m, 'rev', '#ffffff');
      else if (role(m, G.blinkMat, G.blinkNode)) claim(m, 'blink', '#ff9a1a');
    }
    this._own = [...own.values()];
    this._meshes = meshes;
    this._paint = null; // per-car copies of the paint materials, made on the first colour change
    this.headLocal = T.head.map(v => v.clone());
    this.tailLocal = T.tail.map(v => v.clone());
    // indicator state, drawn as amber glows at the lamps (no extra geometry that could poke out of the body)
    this.blink = { left: false, right: false };
  }

  // state: {head, brake, reverse, left, right}
  setLights(st) {
    const tailLevel = st.brake ? 1 : st.head ? 0.38 : 0.12;
    for (const m of this._own) {
      const r = m.userData.role;
      m.emissiveIntensity = r === 'head' ? (st.head ? 1.5 : 0.15) : r === 'tail' ? tailLevel * 2.2 : r === 'rev' ? (st.reverse ? 2 : 0) : (st.left || st.right ? 1.6 : 0);
    }
    this.blink.left = !!st.left;
    this.blink.right = !!st.right;
  }

  // body colour: hex string, or null for the model's original paint
  setPaint(hex) {
    const G = this.spec.glb;
    const re = G.recolor || G.paint || /^paint$/i;
    if (!this._paint) {
      this._paint = [];
      const copies = new Map();
      for (const m of this._meshes) {
        if (!test(re, matName(m))) continue;
        if (!copies.has(m.material)) { const c = m.material.clone(); c.userData.base = m.material.color.clone(); copies.set(m.material, c); this._paint.push(c); }
        m.material = copies.get(m.material);
      }
    }
    for (const mat of this._paint) {
      if (hex) mat.color.set(hex); else mat.color.copy(mat.userData.base);
      // a textured paint is tinted by its colour: keep the texture pattern, lighten it so the tint reads true
    }
  }

  updateWheels(dt, speed, steer) {
    for (const w of this.wheels) {
      w.spin.rotation.x += (speed / w.r) * dt;
      if (w.front) w.pivot.rotation.y = steer;
    }
  }

  // geometry and textures belong to the shared template; only per-car materials are released
  dispose() {
    for (const m of this._own) m.dispose();
    if (this._paint) for (const m of this._paint) m.dispose();
  }
}

// ------------------------------------------------------------------ traffic (instanced)
// A traffic type is drawn with one InstancedMesh per material, so a hundred cars cost a handful of
// draw calls. Parts: the template merged per material in car space; the wheels are cut out per axle so they can roll.
function floatGeometry(m) {
  const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  for (const k of Object.keys(g.attributes)) {
    const a = g.attributes[k];
    if (a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute) continue;
    const f = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = [a.getX, a.getY, a.getZ, a.getW][c].call(a, i);
    g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
  }
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.morphAttributes = {};
  g.applyMatrix4(m.matrixWorld);
  return g;
}
export function trafficGeometry(spec) {
  const T = templates.get(spec.id);
  if (!T) throw new Error('GLB traffic not loaded: ' + spec.id);
  const G = spec.glb;
  T.root.updateMatrixWorld(true);
  const byMat = new Map();
  T.root.traverse(o => {
    if (!o.isMesh) return;
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(floatGeometry(o));
  });
  const parts = [];
  const all = [];
  const merged = [];
  for (const [src, geos] of byMat) {
    const geo = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (!geo) continue;
    all.push(geo);
    merged.push([src, geo]);
  }
  const axles = findAxles(all);
  // named wheel materials (tyres, rims): the radius is half the tyres' height above the road (they
  // touch it), which beats the tread fit on very low-poly tyres
  if (G.wheelMat) for (const a of axles) {
    let top = 0;
    for (const [src, geo] of merged) {
      if (!test(G.wheelMat, src.name)) continue;
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getZ(i) - a.z) < 0.6) top = Math.max(top, p.getY(i));
    }
    if (top > 0.3) a.r = Math.max(a.r, top / 2);
  }
  let tintBase = null; // the tinted material's own colour: the "original" traffic paint
  for (const [src, geo] of merged) {
    const mat = src.clone();
    // exports often leave everything fully metallic (glTF default): tame it so cars do not read as chrome
    if (!mat.metalnessMap) mat.metalness = Math.min(mat.metalness, 0.25);
    mat.roughness = Math.max(mat.roughness, 0.35);
    const tint = test(G.tint, src.name);
    if (tint) { if (!tintBase) tintBase = mat.color.clone(); mat.color.setRGB(1, 1, 1); }
    const pieces = splitWheels(geo, axles, test(G.wheelMat, src.name));
    pieces.forEach((g, k) => { if (g) parts.push({ geo: g, mat, tint, axle: k - 1 }); });
  }
  // lamps: find the body surface at the lamp height (front- / rear-most vertices near x, y)
  const face = (x, y, front) => {
    let best = front ? -Infinity : Infinity;
    for (const g of all) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const vy = p.getY(i), vx = Math.abs(p.getX(i)), vz = p.getZ(i);
        if (Math.abs(vy - y) > 0.14 || Math.abs(vx - x) > 0.3) continue;
        best = front ? Math.max(best, vz) : Math.min(best, vz);
      }
    }
    // big flat faces have few vertices: fall back to the bumper plane when the search lands far inside
    const end = front ? T.box.max.z : T.box.min.z;
    if (!Number.isFinite(best) || Math.abs(best - end) > 0.45) best = end;
    return best + (front ? 0.02 : -0.02);
  };
  const hx = G.lampX || Math.max(0.45, T.W / 2 - 0.32);
  const hz = face(hx, G.headY, true), tz = face(hx, G.tailY, false);
  return {
    parts,
    head: [[hx, G.headY, hz], [-hx, G.headY, hz]],
    tail: [[hx, G.tailY, tz], [-hx, G.tailY, tz]],
    sign: null,
    // width from the tyres' outer faces (+ a little body): the bounding box can be widened by mirrors or stray parts
    halfL: T.L / 2, halfW: axles.length ? Math.min(T.W / 2, Math.max(...axles.map(a => a.xOut)) + 0.12) : T.W / 2,
    tintBase: tintBase || new THREE.Color(1, 1, 1),
    axles: axles.map(a => ({ y: a.r, z: a.z })),
    wheelR: axles.length ? axles.reduce((s, a) => s + a.r, 0) / axles.length : 0.3,
  };
}

// Axles from the tyre contact patches (vertices touching the ground), the radius from the tread:
// the circle through the axle height that the most vertices of the tyre band sit on.
function findAxles(geos) {
  const axles = [];
  for (const front of [true, false]) {
    let z0 = Infinity, z1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (const g of geos) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), z = p.getZ(i), x = Math.abs(p.getX(i));
        if (y > 0.06 || (z > 0) !== front) continue;
        z0 = Math.min(z0, z); z1 = Math.max(z1, z); x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      }
    }
    if (!Number.isFinite(z0) || x1 - x0 > 0.8) continue;
    const zc = (z0 + z1) / 2;
    const band = [];
    for (const g of geos) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = Math.abs(p.getX(i)), y = p.getY(i), z = p.getZ(i);
        if (x >= x0 - 0.01 && x <= x1 + 0.01 && Math.abs(z - zc) < 0.8 && y < 1.2) band.push(y, z - zc);
      }
    }
    let best = 0, r = 0;
    for (let rr = 0.2; rr <= 0.6; rr += 0.005) {
      let n = 0;
      for (let i = 0; i < band.length; i += 2) if (Math.abs(Math.hypot(band[i] - rr, band[i + 1]) - rr) < 0.008) n++;
      if (n > best) { best = n; r = rr; }
    }
    if (best < 20) continue;
    axles.push({ z: zc, r, xIn: x0 - 0.16, xOut: x1 + 0.03 });
  }
  return axles;
}

// [body, axle 0, axle 1...]: triangles fully inside a tyre cylinder go to that axle, re-centred on it
function splitWheels(geo, axles, wholeWheel = false) {
  if (!axles.length) return [geo];
  const pos = geo.attributes.position, nt = pos.count / 3;
  const owner = new Int8Array(nt).fill(-1);
  // a wheel material: every triangle goes to the axle it sits on (by its centre), none stays on the body
  if (wholeWheel) {
    for (let t = 0; t < nt; t++) {
      const z = (pos.getZ(t * 3) + pos.getZ(t * 3 + 1) + pos.getZ(t * 3 + 2)) / 3;
      let best = -1, bd = Infinity;
      axles.forEach((a, k) => { const d = Math.abs(z - a.z); if (d < bd) { bd = d; best = k; } });
      if (bd < axles[best].r * 1.6) owner[t] = best;
    }
  }
  const inside = (i, a) => {
    const x = Math.abs(pos.getX(i)), y = pos.getY(i), z = pos.getZ(i);
    return x >= a.xIn && x <= a.xOut && Math.hypot(y - a.r, z - a.z) <= a.r + 0.015;
  };
  let any = owner.some(o => o >= 0);
  for (let t = 0; t < nt; t++) {
    if (owner[t] >= 0) continue;
    for (let k = 0; k < axles.length; k++) {
      const a = axles[k];
      if (inside(t * 3, a) && inside(t * 3 + 1, a) && inside(t * 3 + 2, a)) { owner[t] = k; any = true; break; }
    }
  }
  if (!any) return [geo];
  const subset = (k) => {
    const tris = [];
    for (let t = 0; t < nt; t++) if (owner[t] === k) tris.push(t);
    if (!tris.length) return null;
    const g = new THREE.BufferGeometry();
    for (const name of Object.keys(geo.attributes)) {
      const src = geo.attributes[name], n = src.itemSize;
      const out = new Float32Array(tris.length * 3 * n);
      let o = 0;
      for (const t of tris) for (let v = 0; v < 3; v++) for (let c = 0; c < n; c++) out[o++] = src.array[(t * 3 + v) * n + c];
      g.setAttribute(name, new THREE.BufferAttribute(out, n));
    }
    if (k >= 0) g.translate(0, -axles[k].r, -axles[k].z);
    g.computeBoundingSphere();
    return g;
  };
  return [subset(-1), ...axles.map((_, k) => subset(k))];
}

// debugging aid: normalised per-mesh layout of a template
export function describeGlb(id) {
  const T = templates.get(id);
  if (!T) return null;
  const out = [];
  T.root.traverse(o => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    out.push(`${o.name} [${matName(o)}] c=${c.toArray().map(v => v.toFixed(2))} s=${s.toArray().map(v => v.toFixed(2))}`);
  });
  return { L: T.L, W: T.W, H: T.H, wheels: T.wheels.map(w => ({ c: w.c.toArray().map(v => +v.toFixed(2)), r: +w.r.toFixed(2), front: w.front })), head: T.head.map(v => v.toArray().map(x => +x.toFixed(2))), tail: T.tail.map(v => v.toArray().map(x => +x.toFixed(2))), meshes: out };
}
