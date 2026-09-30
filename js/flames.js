// Exhaust flames: a short burst of fire from the tailpipes on every backfire pop (the pops are decided
// by audio.js: lifting off the throttle at high revs). Each playable car lists its tips in
// spec.glb.exhaust ([x, y] in metres, from the car's centre line and the ground; measured on the models).
// A tip is a flame cone pointing backwards plus a soft glow; both additive, so bloom makes them burn.
import * as THREE from 'three';

let tex = null;
// a flame: white-blue core, then yellow, orange, fading red (the texture's top is the tip)
function flameTexture() {
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(200,220,255,1)');
  grad.addColorStop(0.18, 'rgba(255,240,170,1)');
  grad.addColorStop(0.45, 'rgba(255,150,40,0.9)');
  grad.addColorStop(0.8, 'rgba(230,50,10,0.35)');
  grad.addColorStop(1, 'rgba(120,10,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 128);
  // soft sides
  const side = g.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.35, 'rgba(0,0,0,0)');
  side.addColorStop(0.65, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = side;
  g.fillRect(0, 0, 64, 128);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,220,150,1)'); r.addColorStop(0.35, 'rgba(255,140,40,0.55)'); r.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export class ExhaustFlames {
  // model: a CarModel just built (not yet moved or turned), spec: its car spec
  constructor(model, spec) {
    const tips = (spec.glb && spec.glb.exhaust) || [];
    this.tips = [];
    this.t = 0;
    if (!tips.length) return;
    model.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model.group);
    const z = box.min.z + 0.04;
    const geo = new THREE.ConeGeometry(0.07, 0.5, 16, 1, true);
    geo.translate(0, 0.25, 0);   // base at the tip of the pipe
    geo.rotateX(-Math.PI / 2);   // pointing backwards (-z)
    for (const [x, y] of tips) {
      const mat = new THREE.MeshBasicMaterial({ map: flameTexture(), color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
      const cone = new THREE.Mesh(geo, mat);
      cone.position.set(x, y, z);
      cone.renderOrder = 7;
      cone.visible = false;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
      glow.position.set(x, y, z - 0.08);
      glow.scale.setScalar(0.5);
      glow.visible = false;
      model.group.add(cone, glow);
      this.tips.push({ cone, glow, k: 0 });
    }
  }
  // one pop: every tip fires (each a little different)
  burst(strength = 1) {
    for (const tp of this.tips) tp.k = Math.max(tp.k, (0.7 + Math.random() * 0.3) * strength);
    this.update(0); // (shown in this very frame)
  }
  update(dt) {
    this.t += dt;
    for (const tp of this.tips) {
      if (tp.k <= 0) continue;
      tp.k = Math.max(0, tp.k - dt * 9); // ~0.1 s per burst
      const k = tp.k, on = k > 0.01;
      tp.cone.visible = tp.glow.visible = on;
      if (!on) continue;
      const flick = 0.75 + Math.random() * 0.5;
      tp.cone.scale.set(0.8 + k * 0.6, 0.8 + k * 0.6, (0.35 + k * 0.9) * flick);
      tp.cone.material.opacity = Math.min(1, k * 1.4);
      tp.cone.rotation.z = Math.random() * Math.PI;
      tp.glow.material.opacity = Math.min(0.9, k * 1.1);
      tp.glow.scale.setScalar(0.35 + k * 0.45 * flick);
    }
  }
  dispose() {
    for (const tp of this.tips) {
      tp.cone.removeFromParent(); tp.glow.removeFromParent();
      tp.cone.material.dispose(); tp.glow.material.dispose();
    }
    if (this.tips.length) this.tips[0].cone.geometry.dispose();
    this.tips = [];
  }
}
