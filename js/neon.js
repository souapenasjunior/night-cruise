// Neon underglow: LED strips under the car lighting the road around it. Bought with yen per colour
// (neons / neon_unlocks in the database, buy_neon), fitted per car (settings: S.neon[carId]).
// Two parts, no real light (costs nothing, never changes the shaders):
//   - the strips: thin, very bright bars under both sills and across both bumpers (the bloom makes them
//     read as LEDs);
//   - their light on the road: a tight glow along the car's outline, fading fast.
// The glow is drawn after the road and before the car (render order), pulled a little towards the camera
// in depth: it never sinks into the asphalt where the road curves (hills, dips), the car still covers it
// (tyres included), and buildings or walls in front still hide it.
import * as THREE from 'three';
import { RIDE } from './util.js';

// the colours on sale (the database has the same list with prices); names in i18n.js: neon.<id>
export const NEONS = [
  { id: 'blue', hex: '#1f7bff' },
  { id: 'cyan', hex: '#19f0ff' },
  { id: 'pink', hex: '#ff2bd6' },
  { id: 'green', hex: '#2bff6a' },
  { id: 'purple', hex: '#9a4dff' },
];
export const neonHex = id => { const n = NEONS.find(x => x.id === id); return n ? n.hex : null; };

const PAD = 0.5;          // metres of light beyond the body on each side
const GLOW_ORDER = 1;     // after the road and the world (0)...
const CAR_ORDER = 2;      // ...before the car wearing it
const texCache = new Map();
// the light on the road, white (the colour comes from the material): a band just outside the body's
// outline where the strips shine down, fading within half a metre; dim under the floor pan
function glowTexture(W, L) {
  const key = `${W.toFixed(2)}x${L.toFixed(2)}`;
  if (texCache.has(key)) return texCache.get(key);
  const pw = W + PAD * 2, pl = L + PAD * 2, k = 100; // px per metre
  const c = document.createElement('canvas');
  c.width = Math.round(pw * k); c.height = Math.round(pl * k);
  const g = c.getContext('2d');
  const rr = (inset, rad) => {
    g.beginPath();
    g.roundRect(PAD * k + inset * k, PAD * k + inset * k, (W - inset * 2) * k, (L - inset * 2) * k, rad * k);
  };
  // the pool of light right around the car
  g.filter = `blur(${0.16 * k}px)`;
  g.fillStyle = 'rgba(255,255,255,0.62)';
  rr(-0.08, 0.3); g.fill();
  // the bright line on the asphalt under the strips
  g.filter = `blur(${0.075 * k}px)`;
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 0.12 * k;
  rr(0.08, 0.28); g.stroke();
  // under the car: darker (the floor pan)
  g.filter = `blur(${0.12 * k}px)`;
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,0.6)';
  rr(0.35, 0.2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

// the glow is pulled this far towards the camera in depth (not on screen): it stays over the road
// where the road bends under a straight car, and behind anything really in front of it
function pullToCamera(mat, metres) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include project_vertex', `
      vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
      mvPosition.xyz *= max( 0.0, 1.0 - ${metres.toFixed(3)} / max( length( mvPosition.xyz ), 0.001 ) );
      gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'neon-pull';
}

// put neon of the given colour under a car model (null: none). The model's group origin is on the
// ground (at the tyres' bottom), centred between the axles, like all of ours.
export function setNeon(model, hex) {
  let rig = model.group.getObjectByName('neon');
  if (!hex) { if (rig) rig.visible = false; return; }
  if (!rig) {
    const W = model.W || 1.8, L = model.L || 4.4;
    rig = new THREE.Group();
    rig.name = 'neon';
    // the light on the road (drawn in the opaque pass, additive, at its render order)
    const glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(W, L), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    pullToCamera(glowMat, 0.3);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(W + PAD * 2, L + PAD * 2), glowMat);
    glow.name = 'neon-glow';
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.02 - RIDE; // (on the road: the car rides RIDE above it)
    glow.renderOrder = GLOW_ORDER;
    rig.add(glow);
    // the strips: under the sills (between the wheel arches) and across both bumpers
    const barMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false });
    const y = 0.11, bar = 0.03;
    const sideLen = L * 0.52, xs = W / 2 - 0.16, zb = L / 2 - 0.42, bumperLen = W - 0.6;
    for (const [sx, sz, lx, lz] of [[xs, 0, bar, sideLen], [-xs, 0, bar, sideLen], [0, zb, bumperLen, bar], [0, -zb, bumperLen, bar]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(lx, bar * 0.6, lz), barMat);
      m.position.set(sx, y, sz);
      m.name = 'neon-bar';
      rig.add(m);
    }
    model.group.add(rig);
    rig.userData = { glowMat, barMat };
  }
  // the car draws after its glow, so it covers it (wheels included)
  model.group.traverse(o => { if (o.isMesh && !o.name.startsWith('neon')) o.renderOrder = Math.max(o.renderOrder, CAR_ORDER); });
  const c = new THREE.Color(hex);
  rig.userData.glowMat.color.copy(c).multiplyScalar(0.9);  // the road: lit, not blinding
  rig.userData.barMat.color.copy(c).multiplyScalar(2.2);   // the LEDs themselves: bright, they bloom
  rig.visible = true;
}
