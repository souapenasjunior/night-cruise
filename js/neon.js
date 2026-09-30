// Neon underglow: LED strips under the car lighting the road around it. Bought with yen per colour
// (neons / neon_unlocks in the database, buy_neon), fitted per car (settings: S.neon[carId]).
// Drawn as one additive glow on the ground under the car: brightest right along the body's outline (the
// strips), fading out onto the asphalt. No real light: it costs nothing and never changes the shaders.
import * as THREE from 'three';

// the colours on sale (the database has the same list with prices); names in i18n.js: neon.<id>
export const NEONS = [
  { id: 'blue', hex: '#1f7bff' },
  { id: 'cyan', hex: '#19f0ff' },
  { id: 'pink', hex: '#ff2bd6' },
  { id: 'green', hex: '#2bff6a' },
  { id: 'purple', hex: '#9a4dff' },
];
export const neonHex = id => { const n = NEONS.find(x => x.id === id); return n ? n.hex : null; };

const PAD = 0.75; // metres of glow beyond the body on each side
const texCache = new Map();
// a white glow in the shape of the car's footprint (the colour comes from the material)
function glowTexture(W, L) {
  const key = `${W.toFixed(2)}x${L.toFixed(2)}`;
  if (texCache.has(key)) return texCache.get(key);
  const pw = W + PAD * 2, pl = L + PAD * 2, k = 96; // px per metre
  const c = document.createElement('canvas');
  c.width = Math.round(pw * k); c.height = Math.round(pl * k);
  const g = c.getContext('2d');
  const x = PAD * k, y = PAD * k, w = W * k, h = L * k, r = 0.35 * k;
  const rr = (inset, ctx = g) => {
    ctx.beginPath();
    ctx.roundRect(x + inset, y + inset, w - inset * 2, h - inset * 2, Math.max(4, r - inset));
  };
  // the spill onto the road: wide and soft
  g.filter = `blur(${0.32 * k}px)`;
  g.fillStyle = 'rgba(255,255,255,0.55)';
  rr(0.12 * k); g.fill();
  // the strips: a bright band just inside the body's outline
  g.filter = `blur(${0.1 * k}px)`;
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 0.16 * k;
  rr(0.2 * k); g.stroke();
  // the middle under the car: dimmer (the floor pan hides the light)
  g.filter = `blur(${0.25 * k}px)`;
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,0.45)';
  rr(0.55 * k); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

// put neon of the given colour under a car model (null: none). The model must not be turned yet or be a
// CarModel whose group origin is on the ground, centred between the axles (all of ours are).
export function setNeon(model, hex) {
  let glow = model.group.getObjectByName('neon');
  if (!hex) { if (glow) glow.visible = false; return; }
  if (!glow) {
    const W = model.W || 1.8, L = model.L || 4.4;
    const mat = new THREE.MeshBasicMaterial({
      map: glowTexture(W, L), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    glow = new THREE.Mesh(new THREE.PlaneGeometry(W + PAD * 2, L + PAD * 2), mat);
    glow.name = 'neon';
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;
    glow.renderOrder = 2;
    model.group.add(glow);
  }
  // (a little over 1 so the bloom picks the strips up: they read as light, not paint)
  glow.material.color.set(hex).multiplyScalar(1.6);
  glow.visible = true;
}
