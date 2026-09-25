// Settings: defaults, quality presets, persistence and hardware auto-detection.
const KEY = 'nightcruise.settings.v1';

export const PRESETS = {
  low: { renderDist: 550, shadows: 'off', textures: 'low', effects: 'off', traffic: 'low', resScale: 0.75 },
  medium: { renderDist: 850, shadows: 'off', textures: 'medium', effects: 'low', traffic: 'medium', resScale: 1 },
  high: { renderDist: 1150, shadows: 'low', textures: 'high', effects: 'high', traffic: 'high', resScale: 1 },
  ultra: { renderDist: 1500, shadows: 'high', textures: 'high', effects: 'high', traffic: 'max', resScale: 'native' },
};

export const DEFAULT_BINDINGS = {
  accel: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  horn: ['KeyH'], lights: ['KeyL'], lookLeft: ['KeyQ'], lookRight: ['KeyE'],
  camera: ['KeyV'], lookback: ['KeyC'], reset: ['KeyR'], map: ['KeyM'], pause: ['Escape'],
};

// controller buttons (standard mapping) per action; accelerate (RT), brake (LT) and steering (left stick,
// d-pad left / right) stay fixed. An empty list: the action has no button.
export const DEFAULT_PAD = { horn: [1], lights: [3], lookLeft: [4], lookRight: [5], camera: [8], lookback: [11], reset: [12], map: [13], pause: [9] };
export const PAD_FIXED = [6, 7, 14, 15]; // triggers and d-pad left / right: driving, not remappable

export function defaults() {
  return {
    graphics: { preset: 'auto', quality: 'high', ...PRESETS.high, fpsCap: 60, vsync: true },
    display: { mode: 'window' },
    audio: { master: 0.8, engine: 0.8, sfx: 0.8, ambient: 0.6 },
    gameplay: { units: 'kmh', minimap: true, hud: true, camDist: 1, camSmooth: 0.5, vibration: true, mirror: true },
    bindings: JSON.parse(JSON.stringify(DEFAULT_BINDINGS)),
    pad: JSON.parse(JSON.stringify(DEFAULT_PAD)),
    lang: 'auto', // 'auto' (browser language), 'pt' or 'en'
    lastCar: 'kaiju',
    paintIdx: {}, // chosen colour (index into PAINTS) per car id
  };
}

export function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      for (const k of Object.keys(d)) {
        if (s[k] === undefined) continue;
        if (typeof d[k] === 'object' && !Array.isArray(d[k])) Object.assign(d[k], s[k]);
        else d[k] = s[k];
      }
      for (const a of Object.keys(DEFAULT_BINDINGS)) if (!Array.isArray(d.bindings[a])) d.bindings[a] = DEFAULT_BINDINGS[a].slice();
      for (const a of Object.keys(d.bindings)) if (!DEFAULT_BINDINGS[a]) delete d.bindings[a]; // actions that no longer exist
      sanitize(d);
      d._loaded = true;
    }
  } catch (e) { /* storage unavailable */ }
  return d;
}

// Saved settings come from older versions or a hand-edited browser: anything out of range or no longer
// offered falls back to its default (a render distance of 99999 m spread the traffic over 80 km, etc.)
const PAINT_COUNT = 7; // colours offered per car (PAINTS in jdmspecs.js)
function sanitize(s) {
  const d = defaults();
  const num = (obj, def, key, lo, hi) => { const v = Number(obj[key]); obj[key] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def[key]; };
  const bool = (obj, def, key) => { if (typeof obj[key] !== 'boolean') obj[key] = def[key]; };
  const G = s.graphics, g = d.graphics;
  for (const [k, allowed] of [['preset', ['auto', 'low', 'medium', 'high', 'ultra', 'custom']], ['quality', ['low', 'medium', 'high', 'ultra']], ['shadows', ['off', 'low', 'high']], ['textures', ['low', 'medium', 'high']], ['effects', ['off', 'low', 'high']], ['traffic', ['low', 'medium', 'high', 'max']], ['resScale', [0.5, 0.75, 1, 'native']], ['fpsCap', [30, 60, 120, 0]]]) {
    if (!allowed.includes(G[k])) G[k] = g[k];
  }
  num(G, g, 'renderDist', 400, 1600);
  if (!['window', 'fullscreen'].includes(s.display.mode)) s.display.mode = d.display.mode;
  for (const k of ['master', 'engine', 'sfx', 'ambient']) num(s.audio, d.audio, k, 0, 1);
  const P = s.gameplay, p = d.gameplay;
  if (!['kmh', 'mph'].includes(P.units)) P.units = p.units;
  for (const k of ['minimap', 'hud', 'mirror', 'vibration']) bool(P, p, k);
  num(P, p, 'camDist', 0.7, 1.5);
  num(P, p, 'camSmooth', 0, 1);
  for (const k of Object.keys(P)) if (!(k in p)) delete P[k]; // options that no longer exist (e.g. rain)
  for (const a of Object.keys(s.bindings)) s.bindings[a] = s.bindings[a].filter(c => typeof c === 'string');
  if (!s.pad || typeof s.pad !== 'object' || Array.isArray(s.pad)) s.pad = JSON.parse(JSON.stringify(DEFAULT_PAD));
  for (const a of Object.keys(s.pad)) if (!DEFAULT_PAD[a]) delete s.pad[a];
  for (const a of Object.keys(DEFAULT_PAD)) {
    if (!Array.isArray(s.pad[a])) s.pad[a] = DEFAULT_PAD[a].slice();
    s.pad[a] = s.pad[a].filter(b => Number.isInteger(b) && b >= 0 && b <= 16 && !PAD_FIXED.includes(b));
  }
  if (!['auto', 'pt', 'en'].includes(s.lang)) s.lang = d.lang;
  if (typeof s.lastCar !== 'string') s.lastCar = d.lastCar;
  if (!s.paintIdx || typeof s.paintIdx !== 'object' || Array.isArray(s.paintIdx)) s.paintIdx = {};
  for (const [id, i] of Object.entries(s.paintIdx)) if (!Number.isInteger(i) || i < 0 || i >= PAINT_COUNT) delete s.paintIdx[id];
}

export function save(s) {
  try {
    const copy = { ...s };
    delete copy._loaded;
    localStorage.setItem(KEY, JSON.stringify(copy));
  } catch (e) { /* ignore */ }
}

// Guess a sensible starting preset from the GPU string and device hints.
export function detectQuality(renderer) {
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) { /* ignore */ }
  const g = String(gpu).toLowerCase();
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  let q = 'medium';
  if (/rtx|radeon rx|rx \d{4}|arc a|m1 max|m2 max|m3|m4|apple m\d (pro|max)/.test(g)) q = 'high';
  if (/rtx (30|40|50)\d0|rx (6|7|9)\d00|4090|4080|5080|5090/.test(g)) q = 'ultra';
  if (/intel|uhd|iris|mali|adreno|powervr|swiftshader|llvmpipe|basic render/.test(g)) q = 'medium';
  if (/swiftshader|llvmpipe|basic render|mali-4|adreno \(tm\) 3/.test(g) || mobile) q = 'low';
  if (/apple gpu|apple m1|apple m2/.test(g) && !mobile) q = 'high';
  if (cores <= 4 || mem <= 4) q = q === 'ultra' ? 'high' : q === 'high' ? 'medium' : q;
  return { quality: q, gpu };
}

export function applyPreset(s, q) {
  Object.assign(s.graphics, PRESETS[q]);
  s.graphics.quality = q;
}

// [cars, cruisers] - cruisers (the playable cars driving around) are gone; lighter than before so there is room to weave
export const TRAFFIC_COUNTS = { low: [28, 0], medium: [48, 0], high: [72, 0], max: [104, 0] };
export const DYN_LIGHTS = { off: 0, low: 2, high: 4 };
