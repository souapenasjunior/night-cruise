// Procedural canvas textures.
import * as THREE from 'three';
import { makeCanvas, rng, FONT_DISPLAY } from './util.js';

function tex(canvas, { repeat = false, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

// Road surface. Width in meters, lane lines defined by offsets from center.
// U maps across the road (0 = -hw, 1 = +hw), V repeats every `period` meters.
export function roadTexture(spec, q = 1, aniso = 8) {
  const W = Math.round(1024 * q), H = Math.round(512 * q);
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const hw = spec.hw, period = spec.period;
  const U = off => ((off + hw) / (2 * hw)) * W;
  const V = m => (m / period) * H;
  const r = rng(7);
  g.fillStyle = '#26272c';
  g.fillRect(0, 0, W, H);
  // aggregate speckle
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 22 + (r() < 0.03 ? 18 : 0);
    d[i] += n; d[i + 1] += n; d[i + 2] += n + 1;
  }
  g.putImageData(img, 0, 0);
  // wheel tracks (darker, polished)
  for (const lane of spec.lanes) {
    for (const s of [-0.8, 0.8]) {
      const x = U(lane + s);
      const grd = g.createLinearGradient(x - 14 * q, 0, x + 14 * q, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.5, 'rgba(0,0,0,0.22)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - 14 * q, 0, 28 * q, H);
    }
  }
  // median strip
  if (spec.median) {
    g.fillStyle = '#34353a';
    g.fillRect(U(-spec.median), 0, U(spec.median) - U(-spec.median), H);
  }
  // shoulder tint
  g.fillStyle = 'rgba(40,40,46,0.35)';
  g.fillRect(0, 0, U(-spec.edge), H);
  g.fillRect(U(spec.edge), 0, W - U(spec.edge), H);
  const lw = Math.max(2, 0.15 * (W / (2 * hw)));
  const line = (off, color, dash) => {
    g.fillStyle = color;
    const x = U(off) - lw / 2;
    if (!dash) g.fillRect(x, 0, lw, H);
    else g.fillRect(x, V(0), lw, V(dash));
  };
  for (const e of spec.solid) line(e, 'rgba(236,236,228,0.92)');
  for (const e of spec.yellow || []) line(e, 'rgba(236,184,64,0.9)');
  for (const e of spec.dashed) line(e, 'rgba(236,236,228,0.9)', 8);
  // wear on lines
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 900 * q; i++) {
    g.fillStyle = `rgba(90,90,95,${r() * 0.5})`;
    g.fillRect(r() * W, r() * H, 2 + r() * 5, 1 + r() * 3);
  }
  g.globalCompositeOperation = 'source-over';
  // cracks / patches
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(20,20,24,${0.25 + r() * 0.2})`;
    g.fillRect(r() * W, r() * H, 30 * q + r() * 90 * q, 20 * q + r() * 60 * q);
  }
  const t = tex(c, { repeat: true, aniso });
  return t;
}

export const RING_ROAD = { hw: 13.9, period: 20, median: 1.1, edge: 11.9, lanes: [-2.9, -6.5, -10.1, 2.9, 6.5, 10.1], solid: [-11.9, 11.9], yellow: [-1.1, 1.1], dashed: [-4.7, -8.3, 4.7, 8.3] };
export const LINK_ROAD = { hw: 5.6, period: 20, median: 0, edge: 3.6, lanes: [-1.8, 1.8], solid: [-3.6, 3.6], dashed: [0] };

export function radialTexture(size = 128, stops = [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return tex(c, { srgb: false });
}

export function poolTexture() {
  return radialTexture(128, [[0, 'rgba(255,255,255,0.9)'], [0.35, 'rgba(255,255,255,0.45)'], [0.7, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
}

export function textTexture(text, { w = 512, h = 128, color = '#fff', bg = null, font = FONT_DISPLAY, weight = 900, italic = true, stroke = null, strokeW = 0.08, size = 0.8, align = 'center' } = {}) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.font = `${italic ? 'italic ' : ''}${weight} ${Math.round(h * size)}px ${font}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  const x = align === 'center' ? w / 2 : 12;
  if (stroke) {
    g.lineJoin = 'round';
    g.lineWidth = h * strokeW;
    g.strokeStyle = stroke;
    g.strokeText(text, x, h / 2 + h * 0.04);
  }
  g.fillStyle = color;
  g.fillText(text, x, h / 2 + h * 0.04);
  return tex(c);
}

export function checkerTexture(a = '#111', b = '#f2f2f2', n = 8) {
  const c = makeCanvas(128, 128), g = c.getContext('2d');
  const s = 128 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    g.fillStyle = (i + j) % 2 ? a : b;
    g.fillRect(i * s, j * s, s, s);
  }
  const t = tex(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function flowerTexture(col = '#3fa9f5') {
  const c = makeCanvas(256, 128), g = c.getContext('2d');
  const r = rng(3);
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = 5;
  for (let k = 0; k < 7; k++) {
    const x = 20 + r() * 216, y = 20 + r() * 88, s = 10 + r() * 16;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      g.beginPath();
      g.ellipse(x + Math.cos(a) * s * 0.6, y + Math.sin(a) * s * 0.6, s * 0.45, s * 0.25, a, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.arc(x, y, s * 0.18, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

// Expressway direction sign (green, white text).
export function signTexture(lines, { bg = '#1c7a4b', w = 512, h = 192, border = '#e8f0ea' } = {}) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = border;
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = '#f4f7f2';
  g.textBaseline = 'middle';
  let y = h * 0.3;
  for (const L of lines) {
    g.font = `${L.weight || 700} ${L.size || 48}px ${L.font || '"IBM Plex Sans", "Segoe UI", sans-serif'}`;
    g.textAlign = L.align || 'left';
    g.fillText(L.text, L.align === 'right' ? w - 32 : L.align === 'center' ? w / 2 : 32, y);
    y += (L.size || 48) * 1.25;
  }
  return tex(c);
}

// LED variable message sign: amber dot-matrix text on black.
export function vmsTexture(text) {
  const w = 1024, h = 128;
  const src = makeCanvas(w / 4, h / 4), s = src.getContext('2d');
  s.fillStyle = '#000';
  s.fillRect(0, 0, w / 4, h / 4);
  s.fillStyle = '#fff';
  s.font = `700 ${h / 4 - 8}px "IBM Plex Sans", "Yu Gothic", "Meiryo", sans-serif`;
  s.textAlign = 'center';
  s.textBaseline = 'middle';
  s.fillText(text, w / 8, h / 8 + 1);
  const px = s.getImageData(0, 0, w / 4, h / 4).data;
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#050403';
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h / 4; y++) for (let x = 0; x < w / 4; x++) {
    const on = px[(y * (w / 4) + x) * 4] > 90;
    g.fillStyle = on ? '#ffb030' : '#1a1206';
    g.beginPath();
    g.arc(x * 4 + 2, y * 4 + 2, 1.5, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

// Neon billboard.
export function neonTexture(text, sub, hue, r = Math.random) {
  const w = 512, h = 256;
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = `hsl(${hue},40%,6%)`;
  g.fillRect(0, 0, w, h);
  const col = `hsl(${hue},100%,62%)`;
  g.strokeStyle = col;
  g.lineWidth = 5;
  g.shadowColor = col;
  g.shadowBlur = 18;
  g.strokeRect(14, 14, w - 28, h - 28);
  g.fillStyle = `hsl(${hue},100%,82%)`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${r() < 0.5 ? 'italic ' : ''}900 ${sub ? 96 : 120}px ${FONT_DISPLAY}`;
  g.fillText(text, w / 2, sub ? h * 0.42 : h / 2);
  if (sub) {
    g.font = `600 40px "IBM Plex Sans", "Yu Gothic", "Meiryo", sans-serif`;
    g.fillStyle = `hsl(${(hue + 40) % 360},100%,75%)`;
    g.fillText(sub, w / 2, h * 0.76);
  }
  return tex(c);
}

// Distant skyline band wrapped around the sky dome (RGBA).
export function skylineTexture() {
  const w = 4096, h = 256;
  const c = makeCanvas(w, h), g = c.getContext('2d');
  const r = rng(11);
  g.clearRect(0, 0, w, h);
  const layers = [[0.55, '#191a2c', 0.35], [0.8, '#12131f', 0.7], [1, '#0b0c15', 1]];
  for (const [hs, col, lit] of layers) {
    let x = 0;
    while (x < w) {
      const bw = 10 + r() * 46;
      const dens = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 6 + hs * 3);
      const bh = (8 + r() * r() * 150 * dens + 20 * dens) * hs;
      g.fillStyle = col;
      g.fillRect(x, h - bh, bw, bh);
      g.fillStyle = 'rgba(255,200,140,0.8)';
      for (let yy = h - bh + 4; yy < h - 2; yy += 5) for (let xx = x + 2; xx < x + bw - 2; xx += 4) {
        if (r() < 0.12 * lit) {
          g.fillStyle = r() < 0.7 ? `rgba(255,${190 + r() * 40 | 0},${120 + r() * 60 | 0},${0.35 + r() * 0.5})` : `rgba(170,200,255,${0.3 + r() * 0.4})`;
          g.fillRect(xx, yy, 2, 2);
        }
      }
      if (bh > 90 && r() < 0.6) { g.fillStyle = '#ff3030'; g.fillRect(x + bw / 2 - 1, h - bh - 2, 3, 3); }
      x += bw + r() * 6;
    }
  }
  // haze near the base
  const grd = g.createLinearGradient(0, h - 90, 0, h);
  grd.addColorStop(0, 'rgba(60,40,70,0)');
  grd.addColorStop(1, 'rgba(70,50,80,0.55)');
  g.fillStyle = grd;
  g.globalCompositeOperation = 'source-atop';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function tunnelTexture() {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#b9b3a4';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#8f897c';
  g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 32) {
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
  }
  const r = rng(5);
  for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(60,55,50,${r() * 0.12})`; g.fillRect(r() * 256, r() * 256, 3 + r() * 20, 2 + r() * 10); }
  // dark lower band (soot)
  const grd = g.createLinearGradient(0, 256, 0, 150);
  grd.addColorStop(0, 'rgba(30,28,26,0.6)');
  grd.addColorStop(1, 'rgba(30,28,26,0)');
  g.fillStyle = grd;
  g.fillRect(0, 150, 256, 106);
  return tex(c, { repeat: true });
}

export function concreteTexture() {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#8c8c8e';
  g.fillRect(0, 0, 256, 256);
  const r = rng(9);
  for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${r() < 0.5 ? 40 : 200},${r() < 0.5 ? 40 : 200},${r() < 0.5 ? 45 : 200},${r() * 0.07})`; g.fillRect(r() * 256, r() * 256, 2 + r() * 30, 1 + r() * 8); }
  for (let k = 0; k < 8; k++) { g.fillStyle = 'rgba(30,30,30,0.18)'; g.fillRect(k * 32, 0, 2, 256); }
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(20,18,16,0.35)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return tex(c, { repeat: true });
}

export function waterNormalTexture() {
  const s = 256;
  const c = makeCanvas(s, s), g = c.getContext('2d');
  const img = g.createImageData(s, s);
  const h = (x, y) => Math.sin(x * 0.19 + Math.sin(y * 0.07) * 2) * 0.5 + Math.sin(y * 0.23 + x * 0.05) * 0.35 + Math.sin((x + y) * 0.41) * 0.15;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
    const i = (y * s + x) * 4;
    img.data[i] = 128 + dx * 60; img.data[i + 1] = 128 + dy * 60; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { repeat: true, srgb: false });
}

export function stripeTexture(a = '#ffd21f', b = '#1b1c20', n = 6) {
  const c = makeCanvas(128, 128), g = c.getContext('2d');
  g.fillStyle = b; g.fillRect(0, 0, 128, 128);
  g.fillStyle = a;
  for (let i = -n; i < n * 2; i++) {
    g.beginPath();
    g.moveTo(i * 128 / n, 0); g.lineTo(i * 128 / n + 128 / n / 2, 0); g.lineTo(i * 128 / n + 128 / n / 2 + 64, 128); g.lineTo(i * 128 / n + 64, 128);
    g.fill();
  }
  return tex(c, { repeat: true });
}
