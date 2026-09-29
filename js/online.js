// Online rooms: other signed-in players' cars on the road with you. The room server (Cloudflare,
// worker/index.js) checks who each player is; this file sends our car's state ~6 times a second and
// draws everyone else's, a quarter of a second behind so their movement can be smoothed between updates.
// There are no collisions between players, and each player's traffic is their own.
import * as THREE from 'three';

// the rooms live on the Cloudflare worker, whichever address the page itself was opened from
export const ONLINE_ORIGIN = 'https://night-cruise.contatoadoniasjunior.workers.dev';
const SEND_EVERY = 1 / 6;     // s
const DELAY = 0.25;           // s behind the latest update (interpolation window)
const PRIVATE_CODE = /^[A-Z0-9]{6}$/;

export const newPrivateCode = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // (no 0/O, 1/I)
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(6));
  for (const b of r) s += abc[b % abc.length];
  return s;
};
export const normaliseCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
export const isCode = c => PRIVATE_CODE.test(c);
// room names as the players read them: public "K1-03", private "#ABC123"
export const roomLabel = room => (room || '').startsWith('p-') ? '#' + room.slice(2) : (room || '').toUpperCase();

// ------------------------------------------------------------------ name tag above a car
function nameTag(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = '700 56px "Big Shoulders Display", "Arial Narrow", sans-serif';
  const w = Math.min(500, g.measureText(text).width + 56);
  g.fillStyle = 'rgba(8, 10, 20, 0.72)';
  g.beginPath(); g.roundRect((512 - w) / 2, 22, w, 84, 16); g.fill();
  g.fillStyle = '#ffd27a';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(3.2, 0.8, 1);
  s.renderOrder = 6;
  return s;
}

export class Online {
  // hooks: token() -> Promise<string>, spec(carId) -> car spec, load(spec) -> Promise<bool>,
  //        model(spec) -> car model, status(kind, info) -> the game shows it (connected, joined, left...)
  constructor(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks;
    this.ws = null;
    this.room = null;
    this.myId = null;
    this.car = null;
    this.remotes = new Map(); // id -> { name, car, model, tag, buf: [{ t, s }] }
    this.sendT = 0;
    this.clock = 0;
    this.want = null;         // the room we are (re)connecting to
    this.retry = 0;
  }
  get connected() { return !!(this.ws && this.ws.readyState === 1 && this.myId); }
  get count() { return this.remotes.size + (this.myId ? 1 : 0); }

  // room: 'auto' (a public room with space), or a private code (6 letters/digits)
  async join(room, carId) {
    this.leave();
    this.car = carId;
    let id = room;
    if (room === 'auto') {
      const r = await fetch(`${ONLINE_ORIGIN}/api/online/join`).then(x => x.json()).catch(() => null);
      if (!r || !r.room) { this.hooks.status('error', 'net'); return false; }
      id = r.room;
    } else id = 'p-' + normaliseCode(room);
    this.want = id;
    this.retry = 0;
    return this.connect();
  }
  async connect() {
    const id = this.want;
    if (!id) return false;
    const token = await this.hooks.token();
    if (!token) { this.hooks.status('error', 'auth'); return false; }
    const ws = new WebSocket(`${ONLINE_ORIGIN.replace(/^http/, 'ws')}/api/online/room/${id}`);
    this.ws = ws;
    this.hooks.status('connecting', roomLabel(id));
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token, car: this.car }));
    ws.onmessage = e => { try { this.onMessage(JSON.parse(e.data)); } catch (err) { /* ignore a bad message */ } };
    ws.onclose = e => {
      if (this.ws !== ws) return; // replaced or left on purpose
      this.clearRemotes();
      this.myId = null;
      this.ws = null;
      const fatal = { 4003: 'auth', 4004: 'car', 4005: 'elsewhere', 4009: 'full' }[e.code];
      if (fatal || !this.want) { this.want = null; this.hooks.status('error', fatal || 'net'); return; }
      // dropped: try again a few times, waiting longer each time
      if (this.retry < 5) {
        const wait = 1000 * 2 ** this.retry++;
        this.hooks.status('reconnecting', roomLabel(id));
        setTimeout(() => { if (this.want === id && !this.ws) this.connect(); }, wait);
      } else { this.want = null; this.hooks.status('error', 'net'); }
    };
    return true;
  }
  leave() {
    this.want = null;
    const ws = this.ws;
    this.ws = null;
    this.myId = null;
    this.room = null;
    if (ws) try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    this.clearRemotes();
  }
  // the car changed (a new one picked from the pause menu)
  async setCar(carId) {
    this.car = carId;
    if (!this.connected) return;
    const token = await this.hooks.token();
    this.ws.send(JSON.stringify({ t: 'car', car: carId, token }));
  }

  onMessage(m) {
    if (m.t === 'welcome') {
      this.myId = m.id;
      this.room = m.room;
      this.retry = 0;
      for (const p of m.players) this.addRemote(p);
      this.hooks.status('joined', { room: roomLabel(m.room), count: this.count, max: m.max });
    } else if (m.t === 'join') {
      this.addRemote(m.p);
      this.hooks.status('player', { name: m.p.name, joined: true, count: this.count });
    } else if (m.t === 'leave') {
      const r = this.remotes.get(m.id);
      if (r) { this.removeRemote(m.id); this.hooks.status('player', { name: r.name, joined: false, count: this.count }); }
    } else if (m.t === 's') {
      const r = this.remotes.get(m.id);
      if (r) { r.buf.push({ t: this.clock, s: m.s }); if (r.buf.length > 20) r.buf.shift(); }
    } else if (m.t === 'car') {
      const r = this.remotes.get(m.id);
      if (r) { r.car = m.car; this.buildModel(r); }
    } else if (m.t === 'err') {
      this.hooks.status('error', m.e);
    }
  }
  addRemote(p) {
    if (!p || !p.id || this.remotes.has(p.id)) return;
    const r = { id: p.id, name: p.name, car: p.car, model: null, tag: nameTag(p.name), buf: [] };
    if (p.s) r.buf.push({ t: this.clock, s: p.s });
    this.remotes.set(p.id, r);
    this.buildModel(r);
  }
  // the model is loaded when needed (premium cars come from Storage); until then the name tag shows alone
  async buildModel(r) {
    const spec = this.hooks.spec(r.car);
    if (!spec) return;
    const want = r.car;
    const ok = await this.hooks.load(spec);
    if (!ok || !this.remotes.has(r.id) || r.car !== want) return;
    if (r.model) { this.scene.remove(r.model.group); r.model.dispose && r.model.dispose(); }
    r.model = this.hooks.model(spec);
    r.model.group.add(r.tag);
    r.tag.position.set(0, 2.1, 0);
    this.scene.add(r.model.group);
  }
  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    if (r.model) { this.scene.remove(r.model.group); r.model.dispose && r.model.dispose(); }
    r.tag.material.map.dispose(); r.tag.material.dispose();
    this.remotes.delete(id);
  }
  clearRemotes() { for (const id of [...this.remotes.keys()]) this.removeRemote(id); }

  // every frame while driving: send ours (throttled), move theirs
  update(dt, player) {
    this.clock += dt;
    if (this.connected && player) {
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = SEND_EVERY;
        const L = player.lights;
        const flags = (L.head ? 1 : 0) | (player.braking ? 2 : 0) | (player.blinkOn && (L.left || L.hazard) ? 4 : 0) | (player.blinkOn && (L.right || L.hazard) ? 8 : 0) | (player.reversing ? 16 : 0);
        const s = [player.pos.x, player.pos.y, player.pos.z, player.yaw, player.pitch || 0, player.vf || 0, player.steer || 0, flags];
        if (s.every(Number.isFinite)) this.ws.send(JSON.stringify({ t: 's', s: s.map((v, i) => (i === 7 ? v : Math.round(v * 100) / 100)) }));
      }
    }
    const at = this.clock - DELAY;
    for (const r of this.remotes.values()) {
      if (!r.model || !r.buf.length) continue;
      // the two updates around `at` (or the latest one, carried forward a little)
      let a = r.buf[0], b = r.buf[r.buf.length - 1];
      for (let i = r.buf.length - 1; i > 0; i--) if (r.buf[i - 1].t <= at) { a = r.buf[i - 1]; b = r.buf[i]; break; }
      const span = b.t - a.t;
      const k = span > 0 ? Math.min(1.2, Math.max(0, (at - a.t) / span)) : 1;
      const s = a.s, e = b.s, g = r.model.group;
      let dy = e[3] - s[3];
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      g.position.set(s[0] + (e[0] - s[0]) * k, s[1] + (e[1] - s[1]) * k, s[2] + (e[2] - s[2]) * k);
      g.rotation.set(0, s[3] + dy * k, 0, 'YXZ');
      g.rotation.x = -(s[4] + (e[4] - s[4]) * k);
      const speed = s[5] + (e[5] - s[5]) * k, steer = s[6] + (e[6] - s[6]) * k, f = e[7];
      r.model.updateWheels(dt, speed, -steer * 0.35);
      r.model.setLights({ head: !!(f & 1), brake: !!(f & 2), left: !!(f & 4), right: !!(f & 8), reverse: !!(f & 16) });
      // old updates are dropped once passed
      while (r.buf.length > 2 && r.buf[1].t < at) r.buf.shift();
    }
  }
  // positions of the other players (for the map)
  others() {
    const out = [];
    for (const r of this.remotes.values()) if (r.model) out.push({ name: r.name, x: r.model.group.position.x, z: r.model.group.position.z, yaw: r.model.group.rotation.y });
    return out;
  }
}
