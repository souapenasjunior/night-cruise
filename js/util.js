export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrap = (v, L) => ((v % L) + L) % L;
export const wrapDelta = (d, L) => {
  d = ((d % L) + L) % L;
  return d > L / 2 ? d - L : d;
};

export function rng(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];

export const FONT_DISPLAY = '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif';
export const FONT_BODY = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
