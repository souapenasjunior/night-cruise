// HUD: speedometer, minimap, indicators, route sign and toasts.
import { clamp, wrapDelta } from './util.js';
import { drawParkingBadge, PA_ROAD, PA_BAY } from './map.js';
import { keyName, PAD_LABELS } from './input.js';

const ARC_LEN = 251; // path length of the gauge arc in the SVG

export class Hud {
  constructor(net) {
    this.net = net;
    this.el = document.getElementById('hud');
    this.speedEl = document.getElementById('spd-num');
    this.unitEl = document.getElementById('spd-unit');
    this.arcEl = document.getElementById('spd-arc');
    this.indHead = document.getElementById('ind-head');
    this.zoneEl = document.getElementById('zone');
    this.zoneRoute = document.getElementById('zone-route');
    this.zoneName = document.getElementById('zone-name');
    this.zoneJp = document.getElementById('zone-jp');
    this.toastEl = document.getElementById('toast');
    this.mapWrap = document.getElementById('minimap');
    this.canvas = document.getElementById('minimap-c');
    this.ctx = this.canvas.getContext('2d');
    this.paths = net.ribbons.map(r => {
      const p = new Path2D();
      p.moveTo(r.px[0], r.pz[0]);
      for (let i = 1; i < r.n; i++) p.lineTo(r.px[i], r.pz[i]);
      if (r.closed) p.closePath();
      return p;
    });
    if (net.pa) {
      const a = net.pa.lots[0].pointAt(net.pa.lots[0].len / 2, 0), b = net.pa.lots[1].pointAt(net.pa.lots[1].len / 2, 0);
      this.paCenter = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    }
    this.lastZone = null;
    this.zoneT = 0;
    this.toastT = 0;
    this.shown = -1;
    this.units = 'kmh';
    this.maxSpeed = 250;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }
  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = this.canvas.clientWidth || 170;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.dpr = dpr;
  }
  setOptions({ units, minimap, hud }) {
    this.units = units;
    this.unitEl.textContent = units === 'mph' ? 'mph' : 'km/h';
    this.mapWrap.hidden = !minimap;
    this.el.classList.toggle('hud-off', !hud);
  }
  show(v) { this.el.hidden = !v; }

  // compact list of the car's controls next to the speedometer; lit when active
  updateKeys(player, input, bindings) {
    const pad = input.lastDevice === 'gamepad' && input.hasPad;
    const key = a => (pad ? PAD_LABELS[a] : keyName((bindings[a] || [])[0]));
    const L = player.lights, st = input.state;
    const items = [
      ['lights', 'Faróis', L.head],
      ['horn', 'Buzina', st.horn],
      ['sides', 'Olhar lados', st.lookSide !== 0],
    ];
    items.push(['lookback', 'Olhar p/ trás', st.lookback], ['map', 'Mapa', false], ['camera', 'Câmera', false], ['pause', 'Pausa', false]);
    const html = items.map(([a, label, on]) => {
      const k = a === 'sides' ? (pad ? 'LB RB' : keyName(bindings.lookLeft[0]) + ' ' + keyName(bindings.lookRight[0])) : key(a);
      return `<span class="k${on ? ' on' : ''}"><kbd>${k}</kbd>${label}</span>`;
    }).join('');
    if (html !== this._keysHtml) {
      this._keysHtml = html;
      document.getElementById('keys-hud').innerHTML = html;
    }
  }
  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    this.toastT = 1.8;
  }

  update(dt, player, traffic) {
    const kmh = player.speed * 3.6;
    const shown = Math.round(this.units === 'mph' ? kmh * 0.621371 : kmh);
    if (shown !== this.shown) { this.speedEl.textContent = shown; this.shown = shown; }
    const frac = clamp(kmh / (player.stats.top * 1.02), 0, 1);
    this.arcEl.style.strokeDashoffset = String(ARC_LEN * (1 - frac));
    const L = player.lights, on = player.blinkOn;
    this.indHead.classList.toggle('on', L.head);
    // zones
    let z = null;
    for (const zn of this.net.zones) {
      if (zn.r !== player.rib) continue;
      const d = player.rib.closed ? wrapDelta(player.s - zn.s, player.rib.len) : player.s - zn.s;
      if (Math.abs(d) < 60) { z = zn; break; }
    }
    // (compared by name: the PA's road and bays are one place, no repeated banner between them)
    if (z && (!this.lastZone || z.name !== this.lastZone.name)) {
      this.lastZone = z;
      this.zoneRoute.textContent = z.r.label;
      this.zoneName.textContent = z.name;
      this.zoneJp.textContent = z.jp;
      this.zoneEl.classList.add('on');
      this.zoneT = 4.5;
    }
    if (this.zoneT > 0) { this.zoneT -= dt; if (this.zoneT <= 0) this.zoneEl.classList.remove('on'); }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.classList.remove('on'); }
    // the minimap redraws at 30 Hz: plenty for a map, and it costs half a millisecond per draw
    this.mapT = (this.mapT || 0) - dt;
    if (!this.mapWrap.hidden && this.mapT <= 0) { this.mapT = 1 / 30; this._map(player, traffic); }
  }

  _map(player, traffic) {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const k = (W / 2) / 650; // px per meter: ~650 m radius
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath();
    c.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(8,10,20,0.78)';
    c.fillRect(0, 0, W, H);
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    const rot = -Math.PI / 2 - Math.atan2(fz, fx);
    c.translate(W / 2, H / 2 + H * 0.12);
    c.rotate(rot);
    c.scale(k, k);
    c.translate(-player.pos.x, -player.pos.z);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    const order = this.net.ribbons.map((r, i) => i).sort((a, b) => (this.net.ribbons[a].kind === 'ring' ? 1 : 0) - (this.net.ribbons[b].kind === 'ring' ? 1 : 0));
    for (const i of order) {
      const r = this.net.ribbons[i];
      // widths are exaggerated for legibility; the parking bays keep their real width (square ends)
      const w = r.kind === 'ring' ? 44 : r.kind === 'lot' ? r.hw * 2 : 26;
      c.lineCap = r.kind === 'lot' ? 'butt' : 'round';
      c.strokeStyle = 'rgba(4,6,12,0.95)';
      c.lineWidth = w + 18;
      c.stroke(this.paths[i]);
      c.strokeStyle = r.kind === 'ring' ? 'rgba(206,214,232,0.9)' : r.kind === 'lot' ? PA_BAY : r.kind === 'pa' ? PA_ROAD : 'rgba(255,190,110,0.85)';
      c.lineWidth = w;
      c.stroke(this.paths[i]);
      c.lineCap = 'round';
    }
    // parking area badge (counter-rotated so the P stays upright)
    if (this.paCenter) {
      const dx = this.paCenter.x - player.pos.x, dz = this.paCenter.z - player.pos.z;
      if (dx * dx + dz * dz < 900 * 900) {
        c.save();
        c.translate(this.paCenter.x, this.paCenter.z);
        c.scale(1 / k, 1 / k);
        c.rotate(-rot);
        drawParkingBadge(c, 0, 0, 15 * this.dpr);
        c.restore();
      }
    }
    // vehicles
    for (const a of traffic.agents) {
      if (!a.active) continue;
      const dx = a.x - player.pos.x, dz = a.z - player.pos.z;
      if (dx * dx + dz * dz > 700 * 700) continue;
      if (a.kind === 'cruiser') {
        c.fillStyle = a.spec.colors.main;
        c.beginPath(); c.arc(a.x, a.z, 20, 0, Math.PI * 2); c.fill();
      } else {
        c.fillStyle = 'rgba(120,130,150,0.8)';
        c.fillRect(a.x - 7, a.z - 7, 14, 14);
      }
    }
    c.restore();
    // player arrow
    c.save();
    c.translate(W / 2, H / 2 + H * 0.12);
    const s = W / 170;
    c.fillStyle = '#ffb23f';
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 2 * s;
    c.beginPath();
    c.moveTo(0, -9 * s); c.lineTo(6.5 * s, 7 * s); c.lineTo(0, 3.5 * s); c.lineTo(-6.5 * s, 7 * s); c.closePath();
    c.stroke(); c.fill();
    c.restore();
    // ring
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.lineWidth = 1.5 * this.dpr;
    c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 1.5, 0, Math.PI * 2); c.stroke();
  }
}
