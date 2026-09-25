// Full-screen map (M): the whole expressway network, zones, tunnels, the player and nearby cars.
// Mouse wheel zooms around the cursor, dragging pans, C re-centres on the car.
import { clamp } from './util.js';

// blue "P" parking badge, centred on (x, y), in the current (screen-space) transform
export function drawParkingBadge(c, x, y, size) {
  const r = size * 0.22, h = size / 2;
  c.beginPath();
  c.moveTo(x - h + r, y - h); c.lineTo(x + h - r, y - h); c.quadraticCurveTo(x + h, y - h, x + h, y - h + r);
  c.lineTo(x + h, y + h - r); c.quadraticCurveTo(x + h, y + h, x + h - r, y + h);
  c.lineTo(x - h + r, y + h); c.quadraticCurveTo(x - h, y + h, x - h, y + h - r);
  c.lineTo(x - h, y - h + r); c.quadraticCurveTo(x - h, y - h, x - h + r, y - h);
  c.closePath();
  c.fillStyle = '#1f5fd6'; c.fill();
  c.lineWidth = Math.max(1, size * 0.08); c.strokeStyle = '#eef3ff'; c.stroke();
  c.fillStyle = '#ffffff';
  c.font = `800 ${Math.round(size * 0.72)}px "Big Shoulders Display", "Arial Narrow", sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('P', x, y + size * 0.03);
  c.textAlign = 'left';
}
// road colours by kind: loop, parking area roads, parking bays
export const PA_ROAD = '#5b9bff', PA_BAY = '#a9c8ff';

export class BigMap {
  constructor(net, root) {
    this.net = net;
    this.root = root;
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    // network bounds
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of net.ribbons) for (let i = 0; i < r.n; i++) {
      x0 = Math.min(x0, r.px[i]); x1 = Math.max(x1, r.px[i]); z0 = Math.min(z0, r.pz[i]); z1 = Math.max(z1, r.pz[i]);
    }
    this.bounds = { x0, x1, z0, z1 };
    this.paths = net.ribbons.map(r => this._path(r, 0, r.len));
    this.tunnelPaths = net.ribbons.map(r => (r.tunnelRanges || []).map(([a, b]) => this._path(r, a, b)));
    // ring drawn last so it sits on top of the links
    this.order = net.ribbons.map((r, i) => i).sort((a, b) => (net.ribbons[a].kind === 'ring') - (net.ribbons[b].kind === 'ring'));
    this.zones = net.zones.map(z => { const P = z.r.pointAt(z.s, 0); return { x: P.x, z: P.z, name: z.name, jp: z.jp, route: z.r.label }; });
    // a name given to several ribbons (the PA's road and bays): label it once
    const seen = new Set();
    this.zones = this.zones.filter(z => { const k = z.name; if (seen.has(k)) return false; seen.add(k); return true; });
    if (net.pa) {
      const a = net.pa.lots[0].pointAt(net.pa.lots[0].len / 2, 0), b = net.pa.lots[1].pointAt(net.pa.lots[1].len / 2, 0);
      this.paCenter = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    }
    this.view = { cx: 0, cz: 0, scale: 1 };
    this.fitScale = 1;
    this.drag = null;
    this.isOpen = false;
    this._bind();
  }

  _path(r, s0, s1) {
    const p = new Path2D();
    const i0 = Math.max(0, Math.floor(s0 / r.ds)), i1 = Math.min(r.closed ? r.n : r.n - 1, Math.ceil(s1 / r.ds));
    for (let i = i0; i <= i1; i++) {
      const k = i % r.n;
      if (i === i0) p.moveTo(r.px[k], r.pz[k]); else p.lineTo(r.px[k], r.pz[k]);
    }
    if (r.closed && s0 === 0 && s1 === r.len) p.closePath();
    return p;
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('wheel', e => {
      if (!this.isOpen) return;
      e.preventDefault();
      const k = Math.exp(-e.deltaY * 0.0015);
      this._zoomAt(e.offsetX, e.offsetY, k);
    }, { passive: false });
    c.addEventListener('pointerdown', e => { if (!this.isOpen) return; this.drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz }; c.setPointerCapture(e.pointerId); c.classList.add('grab'); });
    c.addEventListener('pointermove', e => {
      if (!this.drag) return;
      this.view.cx = this.drag.cx - (e.clientX - this.drag.x) / this.view.scale;
      this.view.cz = this.drag.cz - (e.clientY - this.drag.y) / this.view.scale;
    });
    const up = () => { this.drag = null; c.classList.remove('grab'); };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }
  _zoomAt(sx, sy, k) {
    const v = this.view, W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const wx = v.cx + (sx - W / 2) / v.scale, wz = v.cz + (sy - H / 2) / v.scale;
    v.scale = clamp(v.scale * k, this.fitScale * 0.6, this.fitScale * 12);
    v.cx = wx - (sx - W / 2) / v.scale;
    v.cz = wz - (sy - H / 2) / v.scale;
  }
  zoom(k) { this._zoomAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, k); }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.dpr = dpr;
    const b = this.bounds, pad = 70;
    this.fitScale = Math.min((w - pad * 2) / (b.x1 - b.x0), (h - pad * 2) / (b.z1 - b.z0));
  }

  open(player) {
    this.isOpen = true;
    this.root.hidden = false;
    this._resize();
    const b = this.bounds;
    // whole network, centred on the map (the player arrow shows where you are)
    this.view.cx = (b.x0 + b.x1) / 2;
    this.view.cz = (b.z0 + b.z1) / 2;
    this.view.scale = this.fitScale;
    this.player = player;
  }
  close() { this.isOpen = false; this.root.hidden = true; this.drag = null; }
  center(player) { this.view.cx = player.pos.x; this.view.cz = player.pos.z; this.view.scale = Math.max(this.view.scale, this.fitScale * 3); }

  draw(player, traffic) {
    if (!this.isOpen) return;
    this._resize();
    const c = this.ctx, dpr = this.dpr, v = this.view;
    const W = this.canvas.width, H = this.canvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    // world -> screen (css px) -> device px
    const s = v.scale * dpr;
    const tx = W / 2 - v.cx * s, tz = H / 2 - v.cz * s;
    const toScreen = (x, z) => [(x * s + tx) / dpr, (z * s + tz) / dpr];
    c.setTransform(s, 0, 0, s, tx, tz);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    const px = 1 / s; // one device pixel in world units
    // roads: dark casing, then the surface (at least a few pixels wide when zoomed out)
    const R = this.net.ribbons;
    for (const i of this.order) {
      const r = R[i];
      const w = Math.max(r.hw * 2, (r.kind === 'ring' ? 7 : 4.5) * dpr * px);
      c.strokeStyle = 'rgba(3,4,10,0.95)';
      c.lineWidth = w + 6 * dpr * px;
      c.lineCap = r.kind === 'lot' ? 'butt' : 'round';
      c.stroke(this.paths[i]);
    }
    for (const i of this.order) {
      const r = R[i];
      const w = Math.max(r.hw * 2, (r.kind === 'ring' ? 7 : 4.5) * dpr * px);
      c.strokeStyle = r.kind === 'ring' ? '#d9deea' : r.kind === 'lot' ? PA_BAY : r.kind === 'pa' ? PA_ROAD : '#ffbe6e';
      c.lineWidth = w;
      c.lineCap = r.kind === 'lot' ? 'butt' : 'round';
      c.stroke(this.paths[i]);
      c.lineCap = 'round';
      // tunnels: darker, dashed
      if (this.tunnelPaths[i].length) {
        c.save();
        c.strokeStyle = r.kind === 'ring' ? '#5d6680' : '#8a6030';
        c.lineWidth = w * 0.62;
        c.setLineDash([10 * dpr * px, 7 * dpr * px]);
        for (const tp of this.tunnelPaths[i]) c.stroke(tp);
        c.restore();
      }
    }
    // traffic (dim) and cruisers (their paint colour)
    for (const a of traffic.agents) {
      if (!a.active || a.kind === 'cruiser') continue;
      const r = Math.max(2.2, 1.6 * dpr * px * 1.4);
      c.fillStyle = 'rgba(140,150,172,0.7)';
      c.fillRect(a.x - r, a.z - r, r * 2, r * 2);
    }
    for (const a of traffic.agents) {
      if (!a.active || a.kind !== 'cruiser') continue;
      const r = Math.max(4, 4.5 * dpr * px);
      c.beginPath(); c.arc(a.x, a.z, r, 0, Math.PI * 2);
      c.fillStyle = a.spec.colors.main; c.fill();
      c.lineWidth = 1.5 * dpr * px; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.stroke();
    }
    // labels in screen space
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = W / dpr, ch = H / dpr;
    c.textBaseline = 'middle';
    for (const z of this.zones) {
      const isPA = z.route === 'PA' && this.paCenter;
      const [sx, sy] = isPA ? toScreen(this.paCenter.x, this.paCenter.z) : toScreen(z.x, z.z);
      if (sx < -80 || sy < -40 || sx > cw + 80 || sy > ch + 40) continue;
      if (isPA) drawParkingBadge(c, sx, sy, 20);
      else {
        c.fillStyle = '#17744a';
        c.beginPath(); c.arc(sx, sy, 4, 0, Math.PI * 2); c.fill();
        c.lineWidth = 1.5; c.strokeStyle = '#e4efe8'; c.stroke();
      }
      const lx = sx + (isPA ? 16 : 10);
      c.font = '700 15px "Big Shoulders Display", "Arial Narrow", sans-serif';
      const name = z.name.toUpperCase();
      const nw = c.measureText(name).width;
      c.font = '600 10.5px "IBM Plex Sans", sans-serif';
      const jw = c.measureText(z.jp).width;
      const bw = Math.max(nw, jw) + 14;
      c.fillStyle = 'rgba(8,10,20,0.78)';
      c.fillRect(lx - 4, sy - 17, bw, 32);
      c.fillStyle = '#9fd6b7';
      c.fillText(z.jp, lx + 3, sy - 7);
      c.font = '700 15px "Big Shoulders Display", "Arial Narrow", sans-serif';
      c.fillStyle = '#eceff7';
      c.fillText(name, lx + 3, sy + 7);
    }
    // player arrow (always on top)
    const [sx, sy] = toScreen(player.pos.x, player.pos.z);
    const ang = Math.atan2(Math.cos(player.yaw), Math.sin(player.yaw)); // screen angle of the car's heading
    const t = performance.now() / 1000;
    c.save();
    c.translate(sx, sy);
    c.beginPath(); c.arc(0, 0, 16 + 6 * (0.5 + 0.5 * Math.sin(t * 4)), 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,178,63,0.16)'; c.fill();
    c.rotate(ang + Math.PI / 2);
    c.beginPath();
    c.moveTo(0, -13); c.lineTo(9, 10); c.lineTo(0, 5); c.lineTo(-9, 10); c.closePath();
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.stroke();
    c.fillStyle = '#ffb23f'; c.fill();
    c.restore();
    // edge pointer when the car is off screen
    if (sx < 0 || sy < 0 || sx > cw || sy > ch) {
      const ex = clamp(sx, 18, cw - 18), ey = clamp(sy, 18, ch - 18);
      c.beginPath(); c.arc(ex, ey, 7, 0, Math.PI * 2); c.fillStyle = '#ffb23f'; c.fill();
    }
    // scale bar
    const meters = [50, 100, 200, 500, 1000, 2000].find(m => m * v.scale > 90) || 2000;
    const bl = meters * v.scale, bx = cw - 32 - bl, by = ch - 34;
    c.strokeStyle = '#eceff7'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(bx, by - 5); c.lineTo(bx, by); c.lineTo(bx + bl, by); c.lineTo(bx + bl, by - 5); c.stroke();
    c.font = '500 11.5px "IBM Plex Mono", monospace'; c.fillStyle = '#eceff7'; c.textAlign = 'center';
    c.fillText(meters >= 1000 ? `${meters / 1000} km` : `${meters} m`, bx + bl / 2, by - 12);
    c.textAlign = 'left';
  }
}
