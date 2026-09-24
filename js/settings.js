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

export function defaults() {
  return {
    graphics: { preset: 'auto', quality: 'high', ...PRESETS.high, fpsCap: 60, vsync: true },
    display: { mode: 'window' },
    audio: { master: 0.8, engine: 0.8, sfx: 0.8, ambient: 0.6 },
    gameplay: { units: 'kmh', minimap: true, hud: true, camDist: 1, camSmooth: 0.5, vibration: true, mirror: true },
    bindings: JSON.parse(JSON.stringify(DEFAULT_BINDINGS)),
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
      d._loaded = true;
    }
  } catch (e) { /* storage unavailable */ }
  return d;
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
