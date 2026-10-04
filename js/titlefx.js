// The title screen's living backdrop, drawn on a 2D canvas behind the menu: a city skyline whose windows
// switch on and off, an elevated expressway on the horizon with headlights and tail lights streaming along
// it, out-of-focus city lights (bokeh) drifting up, and a few stars. Its colours follow the chosen map
// (Tokyo: sodium orange and blue; Miami: neon pink and cyan). It runs only while the title is shown,
// at the screen's refresh rate but capped to 30 fps, and is a still picture with reduced motion.
const PALETTES = {
  k1: { sky: ['#05060d', '#0c0b1c', '#1b1530'], glow: 'rgba(255, 150, 60, 0.16)', city: '#070811', win: ['#ffb347', '#ffd28a', '#9fc4ff'], bokeh: ['255,170,70', '255,120,60', '120,160,255', '200,120,255'], deck: '#0d0f1a', lamp: '255,180,90' },
  miami: { sky: ['#07051a', '#1c0b2e', '#3a1240'], glow: 'rgba(255, 80, 170, 0.2)', city: '#0a0716', win: ['#5ff2ff', '#ff6ad5', '#ffe08a'], bokeh: ['255,90,200', '80,230,255', '255,170,90', '170,110,255'], deck: '#120c22', lamp: '255,150,220' },
};

const rand = (a, b) => a + Math.random() * (b - a);

export class TitleFx {
  constructor(el) {
    this.el = el;
    this.cv = document.createElement('canvas');
    this.cv.className = 'title-fx';
    this.cv.setAttribute('aria-hidden', 'true');
    el.prepend(this.cv);
    this.ctx = this.cv.getContext('2d');
    this.pal = PALETTES.k1;
    this.running = false;
    this.last = 0;
    this.t = 0;
    this.reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._frame = now => this.frame(now);
    addEventListener('resize', () => { if (this.running) { this.layout(); if (this.reduced) this.draw(0); } });
  }
  setMap(id) { this.pal = PALETTES[id] || PALETTES.k1; if (this.w) this.layout(); }
  start() {
    if (this.running) return;
    this.running = true;
    this.layout();
    this.last = performance.now();
    if (this.reduced) this.draw(0); else requestAnimationFrame(this._frame);
  }
  stop() { this.running = false; }

  // sizes and the scene's fixed parts (skyline, stars), rebuilt on resize or a map change
  layout() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = this.el.clientWidth || innerWidth, h = this.el.clientHeight || innerHeight;
    this.w = w; this.h = h;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.horizon = h * 0.8;
    this.deckY = h * 0.84;
    // two rows of buildings: the far one dimmer and lower
    this.rows = [0, 1].map(r => {
      const list = [];
      for (let x = -20; x < w + 20;) {
        const bw = rand(26, 70) * (r ? 1 : 0.8), bh = rand(0.06, r ? 0.26 : 0.18) * h * (Math.random() < 0.12 ? 1.6 : 1);
        const wins = [];
        for (let wy = 8; wy < bh - 10; wy += 9) for (let wx = 5; wx < bw - 6; wx += 8) {
          if (Math.random() < 0.38) wins.push({ x: wx, y: wy, c: Math.floor(Math.random() * 3), on: Math.random() < 0.7, next: rand(1, 30) });
        }
        list.push({ x, w: bw, h: bh, wins, spire: Math.random() < 0.08 });
        x += bw + rand(-6, 4);
      }
      return list;
    });
    this.stars = Array.from({ length: Math.round(w * h / 9000) }, () => ({ x: rand(0, w), y: rand(0, h * 0.5), r: rand(0.4, 1.2), p: rand(0, 6.3), s: rand(0.4, 1.4) }));
    const n = Math.round(Math.max(14, w / 55));
    this.bokeh = Array.from({ length: n }, () => this.newBokeh(true));
    this.cars = Array.from({ length: Math.round(w / 70) }, () => this.newCar(true));
  }
  newBokeh(any) {
    const { w, h } = this;
    return { x: rand(0, w), y: any ? rand(h * 0.35, h * 1.05) : h + 60, r: rand(14, 60), v: rand(4, 12), dx: rand(-4, 4), c: this.pal.bokeh[Math.floor(Math.random() * this.pal.bokeh.length)], a: rand(0.05, 0.16), p: rand(0, 6.3) };
  }
  newCar(any) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const x = any ? rand(0, this.w) : dir > 0 ? -80 : this.w + 80;
    return { dir, x, v: rand(90, 190), lane: dir > 0 ? 0 : 1 };
  }

  frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this._frame);
    if (this.el.hidden || document.hidden) { this.last = now; return; }
    if (now - this.last < 1000 / 31) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.draw(dt);
  }

  draw(dt) {
    const { ctx, w, h, pal } = this;
    this.t += dt;
    const t = this.t;
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, pal.sky[0]); g.addColorStop(0.62, pal.sky[1]); g.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // the city's glow on the horizon, breathing slowly
    const glow = ctx.createRadialGradient(w / 2, this.horizon + h * 0.1, 0, w / 2, this.horizon + h * 0.1, Math.max(w, h) * 0.7);
    glow.addColorStop(0, pal.glow); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.85 + 0.15 * Math.sin(t * 0.35);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    // stars
    for (const s of this.stars) {
      ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
      ctx.fillStyle = '#dfe6ff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
    // skyline: far row, then near row; windows flick on and off now and then
    this.rows.forEach((row, r) => {
      const base = this.horizon + (r ? 0 : -h * 0.015);
      for (const b of row) {
        ctx.fillStyle = pal.city;
        ctx.globalAlpha = r ? 1 : 0.75;
        ctx.fillRect(b.x, base - b.h, b.w, b.h + h);
        if (b.spire) {
          ctx.fillRect(b.x + b.w / 2 - 1, base - b.h - 24, 2, 24);
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2.4 + b.x);
          ctx.fillStyle = '#ff3b3b';
          ctx.fillRect(b.x + b.w / 2 - 1.5, base - b.h - 27, 3, 3);
        }
        for (const wd of b.wins) {
          wd.next -= dt;
          if (wd.next <= 0) { wd.on = !wd.on; wd.next = wd.on ? rand(8, 40) : rand(2, 14); }
          if (!wd.on) continue;
          ctx.globalAlpha = r ? 0.55 : 0.3;
          ctx.fillStyle = pal.win[wd.c];
          ctx.fillRect(b.x + wd.x, base - b.h + wd.y, 3, 4);
        }
      }
    });
    ctx.globalAlpha = 1;
    // the elevated expressway: deck, its lamps, and the traffic's light streaks
    const dy = this.deckY;
    const dg = ctx.createLinearGradient(0, dy, 0, h);
    dg.addColorStop(0, pal.deck); dg.addColorStop(1, pal.sky[0]);
    ctx.fillStyle = dg;
    ctx.fillRect(0, dy, w, h - dy);
    ctx.fillStyle = `rgba(${pal.lamp},0.35)`;
    ctx.fillRect(0, dy, w, 1);
    for (let x = ((t * 6) % 120) - 120; x < w + 120; x += 120) {
      const lg = ctx.createRadialGradient(x, dy - 18, 0, x, dy - 18, 26);
      lg.addColorStop(0, `rgba(${pal.lamp},0.45)`); lg.addColorStop(1, `rgba(${pal.lamp},0)`);
      ctx.fillStyle = lg; ctx.fillRect(x - 26, dy - 44, 52, 52);
      ctx.fillStyle = `rgba(${pal.lamp},0.25)`; ctx.fillRect(x - 0.5, dy - 18, 1, 18);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      c.x += c.dir * c.v * dt;
      if (c.x < -120 || c.x > w + 120) { this.cars[i] = this.newCar(false); continue; }
      // towards us on the near lane: white headlights; away on the far lane: red tail lights
      const y = dy + (c.lane ? 5 : 11), len = c.v * 0.35;
      const col = c.lane ? '255,60,70' : '255,240,215';
      const sg = ctx.createLinearGradient(c.x, 0, c.x - c.dir * len, 0);
      sg.addColorStop(0, `rgba(${col},0.9)`); sg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = sg;
      ctx.fillRect(Math.min(c.x, c.x - c.dir * len), y - 1, len, 2);
      const hg = ctx.createRadialGradient(c.x, y, 0, c.x, y, 9);
      hg.addColorStop(0, `rgba(${col},0.55)`); hg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = hg; ctx.fillRect(c.x - 9, y - 9, 18, 18);
    }
    // bokeh: soft discs rising slowly, fading near the top
    for (let i = 0; i < this.bokeh.length; i++) {
      const b = this.bokeh[i];
      b.y -= b.v * dt; b.x += b.dx * dt;
      if (b.y < h * 0.25 - b.r) { this.bokeh[i] = this.newBokeh(false); continue; }
      const fade = Math.min(1, (b.y - h * 0.25) / (h * 0.25));
      const a = b.a * fade * (0.75 + 0.25 * Math.sin(t * 0.8 + b.p));
      const bg = ctx.createRadialGradient(b.x, b.y, b.r * 0.2, b.x, b.y, b.r);
      bg.addColorStop(0, `rgba(${b.c},${a})`); bg.addColorStop(0.8, `rgba(${b.c},${a * 0.7})`); bg.addColorStop(1, `rgba(${b.c},0)`);
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // keep the menu readable: a soft dark pool behind the centred text
    const v = ctx.createRadialGradient(w / 2, h * 0.48, 0, w / 2, h * 0.48, Math.max(w, h) * 0.5);
    v.addColorStop(0, 'rgba(5,6,13,0.7)'); v.addColorStop(1, 'rgba(5,6,13,0)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
  }
}
