// Night Cruise — boot, render pipeline, camera, menus, settings and the main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildNetwork } from './network.js';
import { World } from './world.js';
import { HERO_SPECS, CarModel } from './cars.js';
import { loadGlbCars } from './glbcars.js';
import { CREDITS, TRAFFIC_GLB, PAINTS } from './jdmspecs.js';
import { Player } from './player.js';
import { Traffic } from './traffic.js';
import { Hud } from './hud.js';
import { BigMap } from './map.js';
import { AudioSys } from './audio.js';
import { Input, ACTION_LABELS, PAD_LABELS, keyName } from './input.js';
import * as SET from './settings.js';
import { clamp, lerp, damp, wrap } from './util.js';

const $ = id => document.getElementById(id);
const S = SET.load();
const nextFrame = () => new Promise(r => { let done = false; requestAnimationFrame(() => { if (!done) { done = true; r(); } }); setTimeout(() => { if (!done) { done = true; r(); } }, 60); });

// ------------------------------------------------------------------ renderer
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x1b1730, 0.002);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 2000);
camera.position.set(0, 40, 0);
const hemi = new THREE.HemisphereLight(0x5b6aa6, 0x1c140e, 0.62);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0xa4b4ff, 0.35);
moon.position.set(-400, 520, -800);
scene.add(moon);
// Stand-ins for the player car's headlight spot + fill light while no car is on the road. Keeping the
// light count constant means entering or leaving a drive never forces every shader to recompile.
const idleSpot = new THREE.SpotLight(0xffffff, 0, 1, 0.5);
idleSpot.shadow.autoUpdate = false;
const idleLights = new THREE.Group();
idleLights.position.set(0, -800, 0);
idleLights.add(idleSpot, idleSpot.target, new THREE.PointLight(0xffffff, 0, 1));
scene.add(idleLights);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
const renderPass = new RenderPass(scene, camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.35, 0.92);
composer.addPass(renderPass);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ------------------------------------------------------------------ systems
const input = new Input(S.bindings);
const audio = new AudioSys();
let net, world, traffic, hud, player = null, bigMap;
let state = 'loading';
let settingsOpen = false;
let selIndex = Math.max(0, HERO_SPECS.findIndex(s => s.id === S.lastCar));
let camMode = 0;
const lampLights = [];

// ------------------------------------------------------------------ camera rig
function angDamp(a, b, k, dt) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-k * dt));
}
const rig = {
  yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), _pos: new THREE.Vector3(), _look: new THREE.Vector3(), shake: 0, snapNext: true,
  camY: 0,
  // lookback: view from the front; side: -1 left / +1 right (camera beside the car, looking at it)
  update(dt, p, lookback, side = 0) {
    const G = S.gameplay;
    const sp = p.speed;
    let dirYaw = p.yaw;
    if (sp > 4 && p.vf > 0) {
      const vy = Math.atan2(p.vx, p.vz);
      let d = vy - p.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      dirYaw = p.yaw + d * 0.45;
    }
    const snap = this.snapNext;
    this.snapNext = false;
    const k = lerp(2.2, 9, G.camSmooth);
    this.yaw = snap ? dirYaw : angDamp(this.yaw, dirYaw, k, dt);
    const H = p.model.H;
    const pos = this._pos, look = this._look;
    if (camMode === 3) {
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      const b = lookback ? -1 : 1;
      pos.set(p.pos.x + fx * p.halfL * 0.2 * b, p.pos.y + H * 0.86 + 0.12, p.pos.z + fz * p.halfL * 0.2 * b);
      if (side) {
        // hood view: turn the head to that side (the car's left is +x in its frame)
        const lx = Math.cos(p.yaw) * -side, lz = -Math.sin(p.yaw) * -side;
        look.set(pos.x + lx * 30, pos.y - 0.4, pos.z + lz * 30);
      } else look.set(pos.x + fx * 30 * b, pos.y - 0.6, pos.z + fz * 30 * b);
      this.pos.copy(pos);
    } else {
      const yaw = this.yaw + (lookback ? Math.PI : side ? side * Math.PI / 2 : 0);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      // 0 chase, 1 close, 2 far. The camera is attached to the car (in its smoothed heading frame):
      // no world-space position lag (it used to leave it metres behind at speed) and no speed-driven motion.
      const PRESET = [[5.2, 0.34, 1.35], [3.9, 0.3, 1.0], [8.2, 0.42, 2.3]][camMode];
      const d = (PRESET[0] + p.halfL * PRESET[1]) * G.camDist * (side ? 1.1 : 1);
      const h = PRESET[2] + H * 0.55;
      this.camY = snap || lookback || side ? p.pos.y + h : damp(this.camY, p.pos.y + h, 10, dt);
      pos.set(p.pos.x - fx * d, this.camY, p.pos.z - fz * d);
      this.pos.copy(pos);
      if (side) look.set(p.pos.x, p.pos.y + 0.6 + H * 0.25, p.pos.z); // side views frame the car itself
      else look.set(p.pos.x + fx * 4, p.pos.y + 1.0 + H * 0.2, p.pos.z + fz * 4);
    }
    this.shake = damp(this.shake, 0, 4, dt);
    const t = performance.now() / 1000;
    const hs = this.shake * 0.22; // only impacts shake the camera
    camera.position.set(this.pos.x + Math.sin(t * 37) * hs, this.pos.y + Math.sin(t * 43 + 1) * hs, this.pos.z + Math.sin(t * 31 + 2) * hs);
    camera.lookAt(look);
    // a little extra field of view for the sense of speed (too much makes the car look far away)
    const fov = 60 + clamp(sp / 80, 0, 1) * 6 + (camMode === 3 ? 6 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = damp(camera.fov, fov, 3, dt);
      camera.updateProjectionMatrix();
      traffic.setGlowScale(renderer, camera);
    }
  },
};

// title screen drone
const drone = { s: 0, t: 0, shot: 0 };
function updateDrone(dt) {
  const r = net.ring;
  drone.t += dt;
  if (drone.t > 16) { drone.t = 0; drone.shot = (drone.shot + 1) % 3; drone.s = wrap(drone.s + 1400, r.len); }
  drone.s = wrap(drone.s + dt * 24, r.len);
  const shots = [[-26, 15, -4, 70], [18, 5, -6, 55], [-60, 42, 0, 140]];
  const [off, h, lookOff, ahead] = shots[drone.shot];
  const P = r.pointAt(drone.s, off);
  const Q = r.pointAt(wrap(drone.s + ahead, r.len), lookOff);
  camera.position.set(P.x, P.y + h + Math.sin(drone.t * 0.4) * 1.2, P.z);
  camera.lookAt(Q.x, Q.y + 3, Q.z);
  if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); traffic.setGlowScale(renderer, camera); }
}


// ------------------------------------------------------------------ rear-view mirror
const mirror = {
  rt: new THREE.WebGLRenderTarget(512, 150, { type: THREE.HalfFloatType }),
  cam: new THREE.PerspectiveCamera(50, 3.4, 0.5, 320),
  scene: new THREE.Scene(),
  ortho: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
  el: $('mirror'),
};
{
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: mirror.rt.texture, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  q.scale.x = -1;
  mirror.scene.add(q);
}
function renderMirror() {
  const p = player;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  mirror.cam.position.set(p.pos.x + fx * 0.2, p.pos.y + p.model.H + 0.35, p.pos.z + fz * 0.2);
  mirror.cam.lookAt(p.pos.x - fx * 40, p.pos.y + 0.6, p.pos.z - fz * 40);
  p.model.group.visible = false;
  const fog = scene.fog;
  renderer.setRenderTarget(mirror.rt);
  renderer.render(scene, mirror.cam);
  renderer.setRenderTarget(null);
  p.model.group.visible = true;
  scene.fog = fog;
  const r = mirror.el.getBoundingClientRect();
  const H = canvas.clientHeight;
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setScissor(r.left, H - r.bottom, r.width, r.height);
  renderer.setViewport(r.left, H - r.bottom, r.width, r.height);
  renderer.render(mirror.scene, mirror.ortho);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
  renderer.autoClear = true;
}

// ------------------------------------------------------------------ showroom
const show = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(32, 1, 0.1, 120), models: new Map(), current: null, yaw: 0.7, spin: 0.25, drag: null, t: 0 };
{
  const s = show.scene;
  s.background = new THREE.Color('#090c18');
  s.fog = new THREE.Fog(0x090c18, 16, 34);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 72), new THREE.MeshStandardMaterial({ color: 0x0f1320, roughness: 0.3, metalness: 0.6 }));
  floor.rotation.x = -Math.PI / 2;
  s.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.9, 3.96, 128), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb23f').multiplyScalar(1.6) }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  s.add(ring);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(4.6, 4.62, 128), new THREE.MeshBasicMaterial({ color: 0x3a4466 }));
  ring2.rotation.x = -Math.PI / 2;
  ring2.position.y = 0.01;
  s.add(ring2);
  s.add(new THREE.HemisphereLight(0x8a9ad0, 0x101018, 0.35));
  const key = new THREE.SpotLight(0xffffff, 110, 40, 0.55, 0.8, 1.6);
  key.position.set(4, 9, 7);
  s.add(key);
  const rimA = new THREE.PointLight(0xffa640, 22, 18, 1.8); rimA.position.set(-6, 3.2, -5); s.add(rimA);
  const rimB = new THREE.PointLight(0x40c8ff, 18, 18, 1.8); rimB.position.set(6, 2.8, -6); s.add(rimB);
  const top = new THREE.DirectionalLight(0xc8d4ff, 0.45); top.position.set(0, 10, 2); s.add(top);
}
function showModel(spec) {
  let m = show.models.get(spec.id);
  if (!m) { m = new CarModel(spec, { hq: true }); m.setLights({ head: true }); show.models.set(spec.id, m); }
  if (m.setPaint) m.setPaint(paintOf(spec));
  if (show.current) show.scene.remove(show.current.group);
  show.current = m;
  show.scene.add(m.group);
}
function updateShowroom(dt) {
  show.t += dt;
  if (!show.drag) show.yaw += dt * show.spin;
  const m = show.current;
  if (!m) return;
  m.group.rotation.y = show.yaw;
  m.setLights({ head: true });
  const L = m.L;
  const d = 5.8 + L * 0.95;
  const narrow = innerWidth < 760;
  show.cam.position.set(narrow ? 0 : -1.3, 2.3 + L * 0.1, d);
  show.cam.lookAt(narrow ? 0 : -1.9, 0.6 + (narrow ? -0.5 : 0), 0);
}

// ------------------------------------------------------------------ lamp lights (nearest street lamps get a real light)
// n lamps lit at once, plus two spare lights so a lamp can fade in while another fades out
function setLampCount(n) {
  n = n > 0 ? n + 2 : 0;
  lampActive = Math.max(0, n - 2);
  while (lampLights.length > n) scene.remove(lampLights.pop());
  while (lampLights.length < n) {
    const l = new THREE.PointLight(0xffffff, 0, 46, 1.7);
    scene.add(l);
    lampLights.push(l);
  }
}
let lampT = 0, lampActive = 0;
// The nearest lamps get a real light. Lights never jump from one lamp to another: a lamp that drops out of
// the set fades out, and its slot only takes a new lamp once dark (sudden swaps read as flicker).
function updateLampLights(dt, fx, fz, x, z) {
  if (!lampLights.length) return;
  for (const l of lampLights) {
    const want = l.userData.lamp ? l.userData.want : 0;
    l.intensity = damp(l.intensity, want, 8, dt);
    if (!l.userData.lamp && l.intensity < 2) l.intensity = 0;
  }
  lampT -= dt;
  if (lampT > 0) return;
  lampT = 0.1;
  const cx = x + fx * 22, cz = z + fz * 22;
  const best = [];
  for (const L of world.lamps) {
    const d = (L.x - cx) ** 2 + (L.z - cz) ** 2;
    if (d > 150 * 150) continue;
    best.push([d, L]);
  }
  best.sort((a, b) => a[0] - b[0]);
  const wanted = new Set(best.slice(0, lampActive).map(b => b[1]));
  for (const l of lampLights) if (l.userData.lamp && !wanted.has(l.userData.lamp)) l.userData.lamp = null;
  const lit = new Set(lampLights.map(l => l.userData.lamp).filter(Boolean));
  for (const [, L] of best) {
    if (!wanted.has(L) || lit.has(L)) continue;
    const slot = lampLights.find(l => !l.userData.lamp && l.intensity === 0);
    if (!slot) break;
    slot.userData.lamp = L;
    slot.userData.want = L.tunnel ? 90 : 150;
    slot.position.set(L.x, L.y - 0.4, L.z);
    slot.color.copy(L.color);
    lit.add(L);
  }
}
// ------------------------------------------------------------------ settings application
let lastTex = S.graphics.textures, lastShadows = null;
function pixelRatio() {
  const r = S.graphics.resScale;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return r === 'native' ? dpr : Math.min(1, dpr) * r;
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio());
  composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  show.cam.aspect = w / h;
  show.cam.updateProjectionMatrix();
  if (traffic) traffic.setGlowScale(renderer, camera);
}
window.addEventListener('resize', resize);

function applySettings() {
  const G = S.graphics, P = S.gameplay;
  const rd = G.renderDist;
  scene.fog.density = 1.95 / rd;
  scene.fog.color.set(0x1b1730);
  camera.far = rd * 1.3 + 300;
  camera.updateProjectionMatrix();
  if (traffic) {
    traffic.setRadius(rd * 0.8);
    const [n, c] = SET.TRAFFIC_COUNTS[G.traffic] || SET.TRAFFIC_COUNTS.medium;
    traffic.setCounts(n, c);
    traffic.streaks.mesh.visible = G.effects === 'high';
    traffic.streaks.mat.uniforms.uStrength.value = 0.07;
  }
  if (world) {
    world.poolMesh.visible = G.effects !== 'off';
    world.lampStreaks.mesh.visible = G.effects === 'high';
    world.lampStreaks.mat.uniforms.uStrength.value = 0.06;
    if (G.textures !== lastTex) { world.setTextureQuality(G.textures); lastTex = G.textures; }
  }
  bloom.enabled = G.effects !== 'off';
  // only genuinely hot pixels bloom, and softly: lamps glow without blowing out the picture
  bloom.strength = G.effects === 'high' ? 0.26 : 0.2;
  bloom.threshold = 1.0;
  bloom.radius = 0.3;
  setLampCount((SET.DYN_LIGHTS[G.effects] || 0) + (G.quality === 'ultra' && G.effects === 'high' ? 2 : 0));
  if (player && G.shadows !== lastShadows) { player.setShadows(G.shadows); lastShadows = G.shadows; }
  if (idleSpot.castShadow !== (G.shadows !== 'off')) { idleSpot.castShadow = G.shadows !== 'off'; idleSpot.shadow.needsUpdate = true; }
  if (hud) hud.setOptions({ units: P.units, minimap: P.minimap, hud: P.hud });
  mirror.el.hidden = !P.mirror || state !== 'drive';
  audio.setVolumes(S.audio);
  resize();
}

// ------------------------------------------------------------------ screens
const screens = ['loading', 'title', 'select', 'pause', 'map'];
function showScreen(name) {
  for (const s of screens) $(s).hidden = s !== name;
  $('hud').hidden = !(name === 'drive' || name === 'pause');
  mirror.el.hidden = !(S.gameplay.mirror && name === 'drive');
  const f = focusables()[0];
  if (f && name !== 'drive') setTimeout(() => f.focus({ preventScroll: true }), 30);
}
function focusables() {
  const root = settingsOpen ? $('settings') : $(state === 'pause' ? 'pause' : state);
  if (!root || root.hidden) return [];
  return [...root.querySelectorAll('button, input')].filter(e => !e.disabled && e.offsetParent !== null);
}
function moveFocus(d) {
  const list = focusables();
  if (!list.length) return;
  const i = list.indexOf(document.activeElement);
  const n = list[(i + d + list.length) % list.length];
  n.focus({ preventScroll: false });
  audio.menuBlip(d > 0);
}

// title
// menu sounds: the soft tick plays the moment a menu button is pressed (not on release, which felt late);
// keyboard / pad navigation plays it from its own handlers
document.addEventListener('pointerdown', (e) => {
  const b = e.target && e.target.closest ? e.target.closest('button, input[type=range]') : null;
  if (!b || (state === 'drive' && !settingsOpen)) return;
  audio.init(); audio.setVolumes(S.audio);
  audio.holdTick = false;
  audio.menuBlip(true);
  audio.holdTick = true; // until the click that follows this press has been handled
}, true);
document.addEventListener('pointerup', () => { if (audio.holdTick) setTimeout(() => { audio.holdTick = false; }, 80); }, true);
document.addEventListener('pointercancel', () => { audio.holdTick = false; }, true);
$('btn-play').onclick = () => { audio.init(); audio.setVolumes(S.audio); goSelect(); };
$('btn-settings').onclick = () => { audio.init(); openSettings(); };
// credits (CC BY 4.0 attribution for the car models)
function openCredits() {
  const el = $('cred-list');
  el.innerHTML = '';
  for (const c of CREDITS) {
    const row = document.createElement('div');
    row.className = 'cred';
    const t = document.createElement('b'); t.textContent = c.title;
    const a = document.createElement('span'); a.textContent = 'por ' + c.author + ' · licença ';
    const lic = document.createElement('a'); lic.href = 'https://creativecommons.org/licenses/by/4.0/'; lic.target = '_blank'; lic.rel = 'noopener'; lic.textContent = 'CC BY 4.0';
    a.appendChild(lic);
    const l = document.createElement('a'); l.href = c.url; l.target = '_blank'; l.rel = 'noopener'; l.textContent = c.url;
    row.append(t, a, l);
    el.appendChild(row);
  }
  $('credits').hidden = false;
  setTimeout(() => $('cred-close').focus(), 30);
}
function closeCredits() { $('credits').hidden = true; $('btn-credits').focus(); }
$('btn-credits').onclick = openCredits;
$('cred-close').onclick = closeCredits;

// select: body colour (5 per car; the first is the model's original paint)
const paintIdx = spec => Math.min((S.paintIdx && S.paintIdx[spec.id]) || 0, PAINTS.length - 1);
const paintOf = spec => PAINTS[paintIdx(spec)].hex;
function choosePaint(i) {
  const s = HERO_SPECS[selIndex];
  if (i < 0 || i >= PAINTS.length) return;
  S.paintIdx = S.paintIdx || {};
  S.paintIdx[s.id] = i;
  SET.save(S);
  const m = show.models.get(s.id);
  if (m && m.setPaint) m.setPaint(paintOf(s));
  renderPaints();
  audio.menuBlip(true);
}
function renderPaints() {
  const s = HERO_SPECS[selIndex], el = $('sel-paints');
  el.innerHTML = '';
  const cur = paintIdx(s);
  PAINTS.forEach(({ name, hex }, i) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (i === cur ? ' on' : '');
    b.style.background = hex;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', i === cur);
    b.setAttribute('aria-label', name);
    b.title = name;
    b.onclick = () => choosePaint(i);
    el.appendChild(b);
  });
}

// select
function buildChips() {
  const wrapEl = $('sel-chips');
  wrapEl.innerHTML = '';
  HERO_SPECS.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-label', `${s.name} (${s.cls})`);
    const lum = new THREE.Color(s.colors.main).getHSL({}).l;
    b.innerHTML = `<span class="n" style="color:${lum < 0.25 ? s.colors.accent : s.colors.main}">${s.short || s.number}</span><span class="sw" style="background:linear-gradient(90deg,${s.colors.main},${s.colors.accent || s.colors.main})"></span>`;
    b.onclick = () => { const up = i >= selIndex; selIndex = i; updateSelect(); audio.selectChime(i, up); };
    b.ondblclick = () => startDrive();
    wrapEl.appendChild(b);
  });
}
function statRow(label, frac, value) {
  return `<div class="stat"><span>${label}</span><span class="track"><i style="width:${Math.round(clamp(frac, 0.04, 1) * 100)}%"></i></span><b>${value}</b></div>`;
}
function updateSelect() {
  const s = HERO_SPECS[selIndex];
  $('sel-class').textContent = s.cls;
  $('sel-name').textContent = s.name;
  $('sel-brand').textContent = s.brand;
  $('sel-desc').textContent = s.desc;
  const st = s.stats;
  const zero100 = (27.8 / (st.accel * 0.82)).toFixed(1);
  const unit = S.gameplay.units === 'mph' ? 'mph' : 'km/h';
  const top = S.gameplay.units === 'mph' ? Math.round(st.top * 0.621) : st.top;
  $('sel-stats').innerHTML =
    statRow('Vel. máxima', (st.top - 150) / 170, `${top} ${unit}`) +
    statRow('0–100 km/h', (st.accel - 4.5) / 6, `${zero100} s`) +
    statRow('Aderência', (st.grip - 0.6) / 0.75, st.grip >= 1.05 ? 'alta' : st.grip >= 0.88 ? 'média' : 'baixa') +
    statRow('Traseira', (st.drift - 0.4) / 1.1, st.drift >= 1.2 ? 'solta' : st.drift >= 0.85 ? 'neutra' : 'firme') +
    statRow('Peso', st.mass / 4400, `${st.mass} kg`);
  [...$('sel-chips').children].forEach((c, i) => { c.classList.toggle('sel', i === selIndex); c.setAttribute('aria-selected', i === selIndex); });
  const chip = $('sel-chips').children[selIndex];
  if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  showModel(s);
  renderPaints();
  audio.setCar({ ...s.sound, top: s.stats.top });
}
function goSelect() {
  state = 'select';
  showScreen('select');
  updateSelect();
  audio.mute(false);
  setTimeout(() => { const c = $('sel-chips').children[selIndex]; if (c) c.focus({ preventScroll: true }); }, 40);
}
$('sel-back').onclick = () => { if (player) { state = 'pause'; showScreen('pause'); } else goTitle(); };
$('sel-go').onclick = () => startDrive();
canvas.addEventListener('pointerdown', e => { if (state === 'select') { show.drag = { x: e.clientX, yaw: show.yaw }; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener('pointermove', e => { if (show.drag) show.yaw = show.drag.yaw + (e.clientX - show.drag.x) * 0.01; });
canvas.addEventListener('pointerup', () => { show.drag = null; });

function goTitle() {
  if (player) { player.dispose(); player = null; }
  scene.add(idleLights);
  state = 'title';
  showScreen('title');
  audio.mute(true);
  rig.snapNext = true;
}

// pause
function pauseGame() {
  if (state !== 'drive') return;
  state = 'pause';
  showScreen('pause');
  $('pause-info').textContent = `${player.spec.name} · ${Math.round(player.odo / 1000 * 10) / 10} km rodados`;
  audio.mute(true);
}
function resumeGame() {
  if (state !== 'pause') return;
  state = 'drive';
  showScreen('drive');
  audio.mute(false);
  lastTime = performance.now();
}
// full-screen map: the drive pauses underneath while it is open
function openMap() {
  if (state !== 'drive') return;
  state = 'map';
  showScreen('map');
  bigMap.open(player);
  audio.mute(true);
}
function closeMap() {
  if (state !== 'map') return;
  bigMap.close();
  state = 'drive';
  showScreen('drive');
  audio.mute(false);
  input.edges.clear(); // the key that closed the map must not reopen it on the next frame
  lastTime = performance.now();
}

$('p-resume').onclick = resumeGame;
$('p-car').onclick = () => goSelect();
$('p-reset').onclick = () => { player.reset(); rig.snapNext = true; resumeGame(); };
$('p-settings').onclick = () => openSettings();
$('p-title').onclick = () => goTitle();

// drive
function startDrive() {
  const spec = HERO_SPECS[selIndex];
  S.lastCar = spec.id;
  SET.save(S);
  let spawn = null;
  if (player) {
    spawn = { rib: player.rib, s: player.s, off: player.off, dir: player.lastGood ? player.lastGood.dir : 1, odo: player.odo };
    player.dispose();
  }
  const model = new CarModel(spec, { hq: S.graphics.quality !== 'low', paint: paintOf(spec) });
  player = new Player(net, model, spec, scene);
  scene.remove(idleLights);
  player.odo = spawn ? spawn.odo : 0;
  lastShadows = null;
  if (spawn) {
    const lanes = spawn.rib.lanes[spawn.dir] || spawn.rib.lanes[1];
    let best = lanes[0];
    for (const l of lanes) if (Math.abs(l - spawn.off) < Math.abs(best - spawn.off)) best = l;
    player.place(spawn.rib, spawn.s, best, spawn.dir);
  } else {
    const z = net.zones[0];
    player.place(net.ring, z.s, net.ring.lanes[1][1], 1);
  }
  traffic.heroSpecs = [];
  for (const a of traffic.agents) if (a.active && a.kind === 'cruiser' && a.spec.id === spec.id) traffic._despawn(a);
  // clear the spawn area
  for (const a of traffic.agents) if (a.active && Math.hypot(a.x - player.pos.x, a.z - player.pos.z) < 40) traffic._despawn(a);
  if (!spawn) traffic.populate(player.pos);
  audio.init();
  audio.setCar({ ...spec.sound, top: spec.stats.top });
  audio.mute(false);
  camMode = 0;
  rig.snapNext = true;
  state = 'drive';
  showScreen('drive');
  applySettings();
  hud.lastZone = null;
  hud.toast(`${spec.name} — boa viagem`);
  driveClock = 0; fpsSamples = []; adaptDone = 0;
  lastTime = performance.now();
}

// ------------------------------------------------------------------ settings UI
const TABS = [
  ['graphics', 'Gráficos'], ['display', 'Tela'], ['audio', 'Áudio'], ['controls', 'Controles'], ['gameplay', 'Jogo'],
];
const pct = v => `${Math.round(v * 100)}%`;
const SCHEMA = {
  graphics: [
    { path: 'graphics.preset', label: 'Qualidade gráfica', type: 'seg', opts: [['auto', 'Automática'], ['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['ultra', 'Ultra']], note: () => S.graphics.preset === 'custom' ? 'Personalizada — ajustes individuais abaixo.' : S.graphics.preset === 'auto' ? `Detectada para este hardware: ${qualName(S.graphics.quality)}.` : '' },
    { path: 'graphics.renderDist', label: 'Distância de renderização', type: 'range', min: 400, max: 1600, step: 50, fmt: v => `${v} m`, custom: true },
    { path: 'graphics.shadows', label: 'Sombras', type: 'seg', opts: [['off', 'Desligadas'], ['low', 'Baixa'], ['high', 'Alta']], custom: true },
    { path: 'graphics.textures', label: 'Texturas', type: 'seg', opts: [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta']], custom: true },
    { path: 'graphics.effects', label: 'Efeitos e reflexos', type: 'seg', opts: [['off', 'Desligados'], ['low', 'Básicos'], ['high', 'Completos']], custom: true, note: () => 'Brilho das luzes, reflexos no asfalto e iluminação dinâmica dos postes.' },
    { path: 'graphics.traffic', label: 'Densidade do tráfego', type: 'seg', opts: [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['max', 'Máxima']], custom: true },
    { path: 'graphics.fpsCap', label: 'Limite de FPS', type: 'seg', opts: [[30, '30'], [60, '60'], [120, '120'], [0, 'Ilimitado']], note: () => `${Math.round(1000 / refreshMs)} Hz detectados. O limite se ajusta ao monitor para os quadros ficarem uniformes.` },
    { label: 'V-Sync', type: 'info', text: 'Sempre ativo: o navegador sincroniza os quadros com a taxa do monitor.' },
  ],
  display: [
    { path: 'display.mode', label: 'Modo de exibição', type: 'seg', opts: [['window', 'Janela'], ['fullscreen', 'Tela cheia']] },
    { path: 'graphics.resScale', label: 'Resolução de renderização', type: 'seg', opts: [[0.5, '50%'], [0.75, '75%'], [1, '100%'], ['native', 'Nativa']], custom: true, note: () => `Tela atual: ${innerWidth}×${innerHeight} · densidade ${(window.devicePixelRatio || 1).toFixed(2)}×. O navegador não permite trocar a resolução do monitor; esta opção muda a resolução interna do jogo.` },
  ],
  audio: [
    { path: 'audio.master', label: 'Volume geral', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { path: 'audio.engine', label: 'Motor', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { path: 'audio.sfx', label: 'Efeitos', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, note: () => 'Pneus, buzina, impactos, setas e passagens.' },
    { path: 'audio.ambient', label: 'Ambiente', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, note: () => 'Vento, chuva, tráfego e cidade.' },
  ],
  gameplay: [
    { path: 'gameplay.units', label: 'Unidade de velocidade', type: 'seg', opts: [['kmh', 'km/h'], ['mph', 'mph']] },
    { path: 'gameplay.minimap', label: 'Minimapa', type: 'tog' },
    { path: 'gameplay.hud', label: 'HUD', type: 'tog' },
    { path: 'gameplay.mirror', label: 'Retrovisor', type: 'tog' },
    { path: 'gameplay.camDist', label: 'Distância da câmera', type: 'range', min: 0.7, max: 1.5, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
    { path: 'gameplay.camSmooth', label: 'Sensibilidade da câmera', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, note: () => 'Mais alta: a câmera acompanha as curvas mais rápido.' },
    { path: 'gameplay.vibration', label: 'Vibração do controle', type: 'tog', note: () => (navigator.getGamepads ? 'Funciona em controles com suporte a vibração no navegador.' : 'Não suportado neste navegador.') },
  ],
};
const qualName = q => ({ low: 'Baixa', medium: 'Média', high: 'Alta', ultra: 'Ultra' }[q] || q);
const getPath = p => p.split('.').reduce((o, k) => o[k], S);
const setPath = (p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], S)[last] = v; };
let currentTab = 'graphics';
function openSettings() {
  settingsOpen = true;
  $('settings').hidden = false;
  renderTabs();
  renderOpts();
  setTimeout(() => { const t = $('set-tabs').querySelector('.on'); if (t) t.focus(); }, 30);
}
function closeSettings() {
  settingsOpen = false;
  $('settings').hidden = true;
  SET.save(S);
  const f = focusables()[0];
  if (f) f.focus();
}
function renderTabs() {
  const el = $('set-tabs');
  el.innerHTML = '';
  for (const [id, name] of TABS) {
    const b = document.createElement('button');
    b.className = 'tab' + (id === currentTab ? ' on' : '');
    b.textContent = name;
    b.onclick = () => { currentTab = id; renderTabs(); renderOpts(); b.focus(); };
    el.appendChild(b);
  }
}
function onChange(item, v) {
  setPath(item.path, v);
  if (item.path === 'graphics.preset') {
    if (v === 'auto') { const d = SET.detectQuality(renderer); SET.applyPreset(S, d.quality); S.graphics.preset = 'auto'; }
    else if (v !== 'custom') SET.applyPreset(S, v);
  } else if (item.custom) S.graphics.preset = 'custom';
  if (item.path === 'display.mode') setFullscreen(v === 'fullscreen');
  applySettings();
  SET.save(S);
  renderOpts();
}
function renderOpts() {
  const el = $('set-opts');
  const keepFocus = document.activeElement && document.activeElement.dataset.fid;
  el.innerHTML = '';
  if (currentTab === 'controls') return renderControls(el);
  for (const item of SCHEMA[currentTab]) {
    const row = document.createElement('div');
    row.className = 'opt';
    const lab = document.createElement('div');
    lab.className = 'lab';
    lab.textContent = item.label;
    row.appendChild(lab);
    const v = item.path ? getPath(item.path) : null;
    if (item.type === 'seg') {
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', item.label);
      for (const [val, name] of item.opts) {
        const b = document.createElement('button');
        b.textContent = name;
        b.dataset.fid = item.path + ':' + val;
        const on = v === val || (item.path === 'graphics.preset' && v === 'custom' && false);
        b.className = on ? 'on' : '';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', on);
        b.onclick = () => onChange(item, val);
        seg.appendChild(b);
      }
      row.appendChild(seg);
    } else if (item.type === 'range') {
      const w = document.createElement('div');
      w.className = 'rng';
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.id = 'opt-' + item.path.replace('.', '-');
      inp.min = item.min; inp.max = item.max; inp.step = item.step; inp.value = v;
      inp.dataset.fid = item.path;
      inp.setAttribute('aria-label', item.label);
      const out = document.createElement('output');
      out.textContent = item.fmt(v);
      inp.oninput = () => { out.textContent = item.fmt(+inp.value); setPath(item.path, +inp.value); if (item.custom) S.graphics.preset = 'custom'; applySettings(); };
      inp.onchange = () => { SET.save(S); if (item.custom) renderOpts(); };
      w.append(inp, out);
      row.appendChild(w);
    } else if (item.type === 'tog') {
      const b = document.createElement('button');
      b.className = 'tog' + (v ? ' on' : '');
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', !!v);
      b.setAttribute('aria-label', item.label);
      b.dataset.fid = item.path;
      b.onclick = () => onChange(item, !v);
      row.appendChild(b);
    } else if (item.type === 'info') {
      const t = document.createElement('div');
      t.className = 'chipinfo';
      t.textContent = item.text;
      row.appendChild(t);
    }
    const note = item.note && item.note();
    if (note) { const n = document.createElement('div'); n.className = 'note'; n.textContent = note; row.appendChild(n); }
    el.appendChild(row);
  }
  if (keepFocus) { const f = el.querySelector(`[data-fid="${CSS.escape(keepFocus)}"]`); if (f) f.focus(); }
}
function renderControls(el) {
  const t = document.createElement('table');
  t.className = 'keys';
  t.innerHTML = '<thead><tr><th>Ação</th><th>Teclado</th><th>Controle</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const action of Object.keys(ACTION_LABELS)) {
    const tr = document.createElement('tr');
    const keys = S.bindings[action];
    const td1 = document.createElement('td');
    td1.textContent = ACTION_LABELS[action];
    const td2 = document.createElement('td');
    const kb = document.createElement('button');
    kb.className = 'keybtn';
    kb.textContent = keyName(keys[0]) + (keys[1] ? `  /  ${keyName(keys[1])}` : '');
    kb.setAttribute('aria-label', `Remapear ${ACTION_LABELS[action]}`);
    kb.onclick = () => {
      kb.classList.add('wait');
      kb.textContent = 'Pressione…';
      input.capture = code => {
        if (code !== 'Escape' || action === 'pause') {
          for (const a of Object.keys(S.bindings)) if (a !== action) S.bindings[a] = S.bindings[a].filter(c => c !== code);
          S.bindings[action] = [code, ...(S.bindings[action].slice(1).filter(c => c !== code))];
          SET.save(S);
        }
        renderOpts();
        const again = el.querySelectorAll('.keybtn')[Object.keys(ACTION_LABELS).indexOf(action)];
        if (again) again.focus();
      };
    };
    td2.appendChild(kb);
    const td3 = document.createElement('td');
    td3.className = 'padlab';
    td3.textContent = PAD_LABELS[action];
    tr.append(td1, td2, td3);
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  el.appendChild(t);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:14px;flex-wrap:wrap';
  row.innerHTML = '<span class="chipinfo">Clique em uma tecla para remapear. A tecla secundária (setas) continua valendo.</span>';
  const rb = document.createElement('button');
  rb.className = 'btn small';
  rb.textContent = 'Restaurar teclas';
  rb.onclick = () => { S.bindings = JSON.parse(JSON.stringify(SET.DEFAULT_BINDINGS)); input.bindings = S.bindings; SET.save(S); renderOpts(); };
  row.appendChild(rb);
  el.appendChild(row);
}
$('set-close').onclick = closeSettings;
$('set-reset').onclick = () => {
  const d = SET.defaults();
  const keepCar = S.lastCar;
  for (const k of Object.keys(d)) S[k] = d[k];
  S.lastCar = keepCar;
  input.bindings = S.bindings;
  const q = SET.detectQuality(renderer);
  SET.applyPreset(S, q.quality);
  S.graphics.preset = 'auto';
  applySettings();
  SET.save(S);
  renderOpts();
};
function setFullscreen(on) {
  try {
    if (on && !document.fullscreenElement) {
      const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      if (p && p.catch) p.catch(() => { S.display.mode = 'window'; renderOpts(); hud && hud.toast('Tela cheia indisponível aqui'); });
      else if (!p) { S.display.mode = 'window'; }
    } else if (!on && document.fullscreenElement) document.exitFullscreen();
  } catch (e) { S.display.mode = 'window'; }
}
document.addEventListener('fullscreenchange', () => { S.display.mode = document.fullscreenElement ? 'fullscreen' : 'window'; if (settingsOpen) renderOpts(); });

// ------------------------------------------------------------------ keyboard / pad menu navigation
window.addEventListener('keydown', e => {
  if (input.capture) return;
  if (settingsOpen) {
    if (e.code === 'Escape') { e.preventDefault(); closeSettings(); }
    return;
  }
  if (!$('credits').hidden) {
    if (e.code === 'Escape') { e.preventDefault(); closeCredits(); }
    return;
  }
  if (state === 'title') {
    if (e.code === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    if (e.code === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
  } else if (state === 'select') {
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { selIndex = (selIndex + 1) % HERO_SPECS.length; updateSelect(); $('sel-chips').children[selIndex].focus(); audio.selectChime(selIndex, true); }
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { selIndex = (selIndex - 1 + HERO_SPECS.length) % HERO_SPECS.length; updateSelect(); $('sel-chips').children[selIndex].focus(); audio.selectChime(selIndex, false); }
    if (e.code === 'Enter' && document.activeElement && document.activeElement.classList.contains('chip')) { e.preventDefault(); startDrive(); }
    const dg = /^(Digit|Numpad)([1-7])$/.exec(e.code);
    if (dg) choosePaint(+dg[2] - 1);
    if (e.code === 'Escape') $('sel-back').click();
  } else if (state === 'map') {
    if (e.code === 'Escape' || S.bindings.map.includes(e.code)) { e.preventDefault(); closeMap(); }
    else if (e.code === 'KeyC') bigMap.center(player);
    else if (e.code === 'Equal' || e.code === 'NumpadAdd') bigMap.zoom(1.25);
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') bigMap.zoom(0.8);
  } else if (state === 'pause') {
    if (e.code === 'Escape' || S.bindings.pause.includes(e.code)) { e.preventDefault(); resumeGame(); }
    if (e.code === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    if (e.code === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
  }
});
function padMenus() {
  const p = input.pad;
  if (!p) return;
  const up = input.padPressed(12), down = input.padPressed(13), left = input.padPressed(14), right = input.padPressed(15);
  const a = input.padPressed(0), b = input.padPressed(1), start = input.padPressed(9);
  if (state === 'map') {
    if (b || start || input.padPressed(10)) closeMap();
    else if (input.padPressed(3)) bigMap.center(player);
    return;
  }
  if (state === 'select' && !settingsOpen) {
    if (right || left) { selIndex = (selIndex + (right ? 1 : -1) + HERO_SPECS.length) % HERO_SPECS.length; updateSelect(); audio.selectChime(selIndex, right); }
    const lb = input.padPressed(4), rb = input.padPressed(5);
    if (lb || rb) { const s = HERO_SPECS[selIndex], n = PAINTS.length, cur = paintIdx(s); choosePaint((cur + (rb ? 1 : -1) + n) % n); }
    if (a || start) startDrive();
    if (b) $('sel-back').click();
    return;
  }
  if (up) moveFocus(-1);
  if (down) moveFocus(1);
  const el = document.activeElement;
  if ((left || right) && el && el.type === 'range') { el.value = +el.value + (right ? 1 : -1) * +el.step; el.oninput(); el.onchange(); }
  else if ((left || right) && el && el.parentElement && el.parentElement.classList.contains('seg')) moveFocus(right ? 1 : -1);
  if (a && el && el.click) el.click();
  if (b) {
    if (settingsOpen) closeSettings();
    else if (state === 'pause') resumeGame();
  }
  if (start && state === 'pause' && !settingsOpen) resumeGame();
}

document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'drive') pauseGame(); });

// ------------------------------------------------------------------ main loop
let lastTime = performance.now(), lastRender = 0;
let driveClock = 0, fpsSamples = [], adaptDone = 0;
let rumbleT = 0;
const tmpVel = new THREE.Vector3();

function driveStep(dt) {
  const inp = input.poll();
  // toggles
  if (input.pressed('pause')) { pauseGame(); return; }
  if (input.pressed('map')) { openMap(); return; }
  if (input.pressed('lights')) { player.lights.head = !player.lights.head; hud.toast(player.lights.head ? 'Faróis ligados' : 'Faróis desligados'); }
  if (input.pressed('camera')) { camMode = (camMode + 1) % 4; rig.snapNext = true; hud.toast(['Câmera: perseguição', 'Câmera: perto', 'Câmera: distante', 'Câmera: capô'][camMode]); }
  if (input.pressed('reset')) { player.reset(); rig.snapNext = true; hud.toast('Reposicionado na faixa'); }
  // physics substeps
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  const x0 = player.pos.x, z0 = player.pos.z;
  for (let i = 0; i < n; i++) player.update(h, inp, null);
  // safety net: never let an invalid physics state freeze the game
  if (!Number.isFinite(player.pos.x + player.pos.y + player.pos.z + player.vx + player.vz + player.yaw)) {
    const g = player.lastGood;
    player.pos.set(x0, player.y || 0, z0);
    if (g && Number.isFinite(g.s)) player.place(g.rib, g.s, g.rib.lanes[g.dir] ? g.rib.lanes[g.dir][1] || g.rib.lanes[g.dir][0] : 0, g.dir);
    else player.place(net.ring, net.zones[0].s, net.ring.lanes[1][1], 1);
    rig.snapNext = true;
  }
  player.odo = (player.odo || 0) + Math.hypot(player.pos.x - x0, player.pos.z - z0);
  traffic.update(dt, player, camera);
  // impacts
  let hit = 0;
  for (const s of player.impacts) hit = Math.max(hit, s);
  for (const ev of traffic.events) {
    if (ev.type === 'impact') hit = Math.max(hit, ev.strength);
    if (ev.type === 'pass') audio.passBy(ev.intensity, ev.pan);
    if (ev.type === 'honk') {
      const dx = ev.x - player.pos.x, dz = ev.z - player.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const rx = -Math.cos(player.yaw), rz = Math.sin(player.yaw);
      audio.honkAt((dx * rx + dz * rz) / d, d, ev.heavy, ev.style === 2);
    }
  }
  player.impacts.length = 0;
  if (hit > 0.02) {
    audio.impact(hit);
    rig.shake = Math.min(1.5, rig.shake + hit * 1.6);
    if (S.gameplay.vibration) input.rumble(hit, hit * 0.7, 120 + hit * 260);
  }
  if (player.scrape > 0.05) { audio.scrape(player.scrape); player.scrape *= 0.5; }
  rumbleT -= dt;
  if (S.gameplay.vibration && rumbleT <= 0 && (player.slip > 0.3 || player.speed > 55)) {
    rumbleT = 0.25;
    input.rumble(0, clamp(player.slip * 0.35 + (player.speed > 55 ? 0.06 : 0), 0, 0.5), 200);
  }
  rig.update(dt, player, inp.lookback && !inp.lookSide, inp.lookSide);
  const tunnel = world.inTunnel(player.rib, player.s);
  audio.update(dt, {
    speed: player.speed, throttle: inp.throttle, brake: inp.brake, reverse: player.reversing, slip: player.slip,
    tunnel, horn: inp.horn, trafficNear: traffic.trafficNear,
    blinkOn: player.blinkOn, blinkActive: player.lights.left || player.lights.right || player.lights.hazard,
    other: traffic.nearestCruiser, traffic: traffic.nearestTraffic,
  });
  hud.update(dt, player, traffic);
  hud.updateKeys(player, input, S.bindings);
  updateLampLights(dt, Math.sin(player.yaw), Math.cos(player.yaw), player.pos.x, player.pos.z);
  hemi.intensity = damp(hemi.intensity, tunnel ? 0.3 : 0.62, 3, dt);
  hemi.color.set(tunnel ? 0x8a6a40 : 0x5b6aa6);
  tmpVel.set(player.vx, 0, player.vz);
}

function autoAdapt(dt) {
  if (S.graphics.preset !== 'auto' || adaptDone >= 2) return;
  driveClock += dt;
  if (driveClock < 4) return;
  fpsSamples.push(dt);
  if (fpsSamples.length < 240) return;
  const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  fpsSamples = [];
  const target = S.graphics.fpsCap && S.graphics.fpsCap < 60 ? S.graphics.fpsCap : 60;
  if (1 / avg < target * 0.72) {
    const order = ['low', 'medium', 'high', 'ultra'];
    const i = order.indexOf(S.graphics.quality);
    if (i > 0) {
      SET.applyPreset(S, order[i - 1]);
      S.graphics.preset = 'auto';
      applySettings();
      SET.save(S);
      hud.toast(`Qualidade ajustada automaticamente: ${qualName(order[i - 1])}`);
    }
    adaptDone++;
  } else adaptDone = 2;
}

// display refresh interval, measured from requestAnimationFrame (median of recent frames)
let rafPrev = 0, refreshMs = 1000 / 60;
const rafDts = [];
function frame(now) {
  requestAnimationFrame(frame);
  if (rafPrev) {
    const d = now - rafPrev;
    if (d > 2 && d < 50) {
      rafDts.push(d);
      if (rafDts.length > 120) rafDts.shift();
      if (rafDts.length >= 30 && rafDts.length % 10 === 0) { const s = [...rafDts].sort((a, b) => a - b); refreshMs = s[s.length >> 1]; }
    }
  }
  rafPrev = now;
  tick(now);
}
function tick(now) {
  const cap = S.graphics.fpsCap;
  // the cap is snapped to a whole number of display refreshes so frames stay evenly spaced
  // (60 on a 144 Hz screen runs at 72 instead of alternating 2- and 3-refresh frames, which judders)
  if (cap && now - lastRender < Math.max(1, Math.round(1000 / cap / refreshMs)) * refreshMs - refreshMs * 0.5) return;
  lastRender = now;
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.1) dt = 0.1;
  if (dt <= 0) return;
  if (state === 'loading') { input.poll(); input.endFrame(); return; }
  if (state === 'drive' && !settingsOpen) {
    driveStep(dt);
    autoAdapt(dt);
  } else {
    input.poll();
    padMenus();
  }
  if (state === 'drive' || state === 'title' || state === 'pause' || state === 'map') {
    if (state === 'title') { audio.idle(false); traffic.update(dt, null, camera); updateDrone(dt); updateLampLights(dt, 0, 0, camera.position.x, camera.position.z); }
    if (state !== 'pause' && state !== 'map') world.update(dt, camera);
    renderPass.scene = scene; renderPass.camera = camera;
    if (bloom.enabled) composer.render(); else renderer.render(scene, camera);
    if (state === 'drive' && S.gameplay.mirror && player) renderMirror();
    if (state === 'map') bigMap.draw(player, traffic);
  } else if (state === 'select') {
    updateShowroom(dt);
    audio.idle(false);
    renderPass.scene = show.scene; renderPass.camera = show.cam;
    if (bloom.enabled) composer.render(); else renderer.render(show.scene, show.cam);
  }
  input.endFrame();
}

// ------------------------------------------------------------------ boot
async function boot() {
  const bar = $('load-bar'), msg = $('load-msg');
  const step = async (p, text) => { bar.style.width = `${p}%`; msg.textContent = text; await nextFrame(); };
  try {
    await Promise.race([document.fonts.load('900 40px "Big Shoulders Display"'), new Promise(r => setTimeout(r, 2500))]);
  } catch (e) { /* fonts optional */ }
  const det = SET.detectQuality(renderer);
  if (!S._loaded || S.graphics.preset === 'auto') { SET.applyPreset(S, det.quality); S.graphics.preset = 'auto'; }
  $('set-gpu').textContent = det.gpu ? String(det.gpu).replace(/ANGLE \(|\)$/g, '').slice(0, 60) : '';
  resize();
  await step(12, 'Traçando a via expressa…');
  net = buildNetwork();
  await step(30, 'Erguendo a cidade…');
  world = new World(scene, net, S.graphics);
  await step(50, 'Trazendo os carros para a garagem…');
  let nCars = 0;
  const allCars = [...HERO_SPECS, ...TRAFFIC_GLB];
  await loadGlbCars(allCars, () => { nCars++; bar.style.width = `${50 + (nCars / allCars.length) * 12}%`; });
  await step(62, 'Acendendo os postes…');
  // environment map from the city itself (reflections on paint, glass and asphalt)
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(1, 3000, cubeRT);
  cubeCam.position.set(150, 45, 200);
  world.sky.position.copy(cubeCam.position);
  cubeCam.update(renderer, scene);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(cubeRT.texture).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.9;
  show.scene.environment = env;
  cubeRT.dispose();
  await step(78, 'Colocando o trânsito na pista…');
  const counts = SET.TRAFFIC_COUNTS.max;
  traffic = new Traffic(scene, net, world, { count: counts[0], cruisers: counts[1], heroSpecs: HERO_SPECS, hq: S.graphics.quality !== 'low', streaks: true });
  const [n, c] = SET.TRAFFIC_COUNTS[S.graphics.traffic] || SET.TRAFFIC_COUNTS.medium;
  traffic.setCounts(n, c);
  traffic.setRadius(S.graphics.renderDist * 0.8);
  hud = new Hud(net);
  bigMap = new BigMap(net, $('map'));
  buildChips();
  applySettings();
  drone.s = net.zones[1].s - 300;
  updateDrone(0);
  traffic.populate(camera.position);
  await step(92, 'Compilando shaders…');
  // build every cruiser now and compile its shaders, so a car appearing mid-drive never stalls a frame
  const warm = [];
  for (const s of HERO_SPECS) { const m = traffic._heroModel(s); if (!m.group.parent) { scene.add(m.group); warm.push(m.group); } }
  renderer.compile(scene, camera);
  for (const g of warm) scene.remove(g);
  await step(100, 'Pronto.');
  state = 'title';
  showScreen('title');
  lastTime = performance.now();
  if (location.hash === '#debug') {
    let fake = performance.now();
    window.__nc = {
      scene, net, world, traffic, get player() { return player; }, camera, renderer, S, input, applySettings, openSettings, composer, bloom, audio,
      get state() { return state; },
      step(n = 1, ms = 16.7) { for (let i = 0; i < n; i++) { fake = Math.max(fake + ms, performance.now()); tick(fake); } },
      startDrive: () => startDrive(), goSelect: () => goSelect(),
    };
  }
}

requestAnimationFrame(frame);
boot().catch(err => {
  console.error(err);
  $('load-msg').textContent = 'Não foi possível iniciar o WebGL neste navegador. Tente atualizar a página ou usar outro navegador.';
});
