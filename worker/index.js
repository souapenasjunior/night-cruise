// Night Cruise on Cloudflare: the site's static files plus the online rooms.
//
//   GET  /api/online/join            -> { room } : a public room with space (the Lobby keeps the counts)
//   WS   /api/online/room/<id>       -> the room itself (a Durable Object per room, up to 20 players)
//   everything else                   -> the static site (assets)
//
// Only signed-in players play online. The first message on the socket is { t: 'hello', token, car, neon }
// (neon: the underglow colour fitted, relayed only if the account owns it)
// (plus create: true and max: 2-20 from whoever creates a private room, its player limit):
// the room checks the Supabase access token (signature against the project's public keys, expiry,
// issuer), reads the player's name from the database with that token, and checks that the car is
// theirs. Nothing the browser says about who it is is taken on trust.
// Messages (JSON): 's' = the car's state ~6 times a second, relayed to the others in the room.
import { DurableObject } from 'cloudflare:workers';

const MAX_PLAYERS = 20;
const PUBLIC_ROOMS = 50;                 // k1-01 ... k1-50
const MAX_MSGS_PER_SEC = 15;
const ORIGINS = new Set([
  'https://www.nightcruisegame.com',
  'https://nightcruisegame.com',
  'https://night-cruise.contatoadoniasjunior.workers.dev',
  'http://localhost:8765',
]);
const cors = origin => ({
  'Access-Control-Allow-Origin': ORIGINS.has(origin) ? origin : 'https://www.nightcruisegame.com',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  Vary: 'Origin',
});
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    if (url.pathname === '/api/online/join') {
      if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
      const lobby = env.LOBBY.get(env.LOBBY.idFromName('lobby'));
      const r = await lobby.fetch('https://lobby/pick');
      return json(await r.json(), 200, cors(origin));
    }
    const m = /^\/api\/online\/room\/(k1-\d{2}|p-[A-Z0-9]{6})$/.exec(url.pathname);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket expected', { status: 426 });
      if (!ORIGINS.has(origin)) return new Response('origin not allowed', { status: 403 });
      const room = env.ROOM.get(env.ROOM.idFromName(m[1]));
      const fwd = new Request(req, { headers: new Headers(req.headers) });
      fwd.headers.set('x-room', m[1]);
      return room.fetch(fwd);
    }
    if (url.pathname.startsWith('/api/')) return new Response('not found', { status: 404 });
    return env.ASSETS.fetch(req);
  },
};

// ------------------------------------------------------------------ player check (Supabase)
let jwks = null, jwksAt = 0;
async function publicKey(env, kid) {
  if (!jwks || Date.now() - jwksAt > 10 * 60 * 1000) {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    if (!r.ok) throw new Error('jwks');
    jwks = (await r.json()).keys || [];
    jwksAt = Date.now();
  }
  const k = jwks.find(x => x.kid === kid);
  if (!k || k.alg !== 'ES256') return null;
  return crypto.subtle.importKey('jwk', k, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}
const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
// the player's id if the access token is genuine and current, else null
async function verifyToken(env, token) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const head = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    const body = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
    if (head.alg !== 'ES256') return null;
    const key = await publicKey(env, head.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;
    if (body.iss !== `${env.SUPABASE_URL}/auth/v1` || body.role !== 'authenticated' || !body.sub) return null;
    if (!body.exp || body.exp * 1000 < Date.now()) return null;
    return body.sub;
  } catch (e) { return null; }
}
// read through the Data API as the player (Row Level Security applies: they only see their own rows)
async function asPlayer(env, token, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}
const CAR_ID = /^[a-z0-9_]{1,32}$/;
const ownsCar = async (env, token, car) => CAR_ID.test(car) && !!(await asPlayer(env, token, `car_unlocks?select=car_id&car_id=eq.${car}`) || []).length;
// the neon underglow colour the player fitted: shown to the others only if the account owns it
const neonOf = async (env, token, neon) => (typeof neon === 'string' && CAR_ID.test(neon) && (await asPlayer(env, token, `neon_unlocks?select=neon_id&neon_id=eq.${neon}`) || []).length ? neon : null);

// ------------------------------------------------------------------ lobby: which public room to join
export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.counts = new Map(); // room -> { n, at }
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/count') {
      const { room, n } = await req.json();
      if (/^k1-\d{2}$/.test(room)) this.counts.set(room, { n: Math.max(0, n | 0), at: Date.now() });
      return new Response('ok');
    }
    // pick: the fullest public room that still has space (players meet each other), else the first
    const fresh = [];
    for (let i = 1; i <= PUBLIC_ROOMS; i++) {
      const room = 'k1-' + String(i).padStart(2, '0');
      const c = this.counts.get(room);
      const n = c && Date.now() - c.at < 3 * 60 * 1000 ? c.n : 0;
      fresh.push({ room, n });
    }
    const open = fresh.filter(r => r.n < MAX_PLAYERS - 1).sort((a, b) => b.n - a.n);
    return json({ room: (open[0] || fresh[0]).room, players: open[0] ? open[0].n : 0 });
  }
}

// ------------------------------------------------------------------ a room
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map(); // ws -> { id, uid, name, car, state, win, cnt }
    // back from hibernation: the sockets are still there, with who they are attached
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id) this.players.set(ws, { ...a, state: null, win: 0, cnt: 0 });
    }
  }
  async fetch(req) {
    const room = req.headers.get('x-room');
    if (room && !this.room) { this.room = room; await this.ctx.storage.put('room', room); }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    // a socket that never says hello is dropped
    await this.ctx.storage.setAlarm(Date.now() + 15000);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async roomName() { return this.room || (this.room = await this.ctx.storage.get('room')) || '?'; }
  pub(p) { return { id: p.id, name: p.name, car: p.car, neon: p.neon || null, s: p.state }; }
  send(ws, msg) { try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch (e) { /* closing */ } }
  others(ws, msg) {
    const s = JSON.stringify(msg);
    for (const [w, p] of this.players) if (w !== ws && p.id) this.send(w, s);
  }
  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 4096) { ws.close(4000, 'bad message'); return; }
    let m;
    try { m = JSON.parse(raw); } catch (e) { ws.close(4000, 'bad message'); return; }
    const p = this.players.get(ws);
    if (!p) return this.hello(ws, m);
    // flood guard
    const sec = Math.floor(Date.now() / 1000);
    if (p.win !== sec) { p.win = sec; p.cnt = 0; }
    if (++p.cnt > MAX_MSGS_PER_SEC) return;
    if (m.t === 's' && Array.isArray(m.s) && m.s.length === 8) {
      const s = m.s;
      const st = [num(s[0], -1e5, 1e5), num(s[1], -1e3, 1e3), num(s[2], -1e5, 1e5), num(s[3], -100, 100), num(s[4], -2, 2), num(s[5], -150, 150), num(s[6], -1.5, 1.5), num(s[7], 0, 255)];
      if (st.some(v => v === null)) return;
      p.state = st.map((v, i) => (i === 7 ? v | 0 : Math.round(v * 100) / 100));
      this.others(ws, { t: 's', id: p.id, s: p.state });
    } else if (m.t === 'car' && typeof m.car === 'string' && typeof m.token === 'string') {
      if (!(await ownsCar(this.env, m.token, m.car))) { this.send(ws, { t: 'err', e: 'car' }); return; }
      p.car = m.car;
      p.neon = await neonOf(this.env, m.token, m.neon);
      ws.serializeAttachment({ id: p.id, uid: p.uid, name: p.name, car: p.car, neon: p.neon });
      this.others(ws, { t: 'car', id: p.id, car: p.car, neon: p.neon });
    }
  }
  async hello(ws, m) {
    if (!m || m.t !== 'hello') { ws.close(4001, 'hello first'); return; }
    const uid = await verifyToken(this.env, m.token);
    if (!uid) { this.send(ws, { t: 'err', e: 'auth' }); ws.close(4003, 'auth'); return; }
    const prof = await asPlayer(this.env, m.token, `profiles?select=username&id=eq.${uid}`);
    const name = prof && prof[0] && prof[0].username;
    if (!name) { this.send(ws, { t: 'err', e: 'auth' }); ws.close(4003, 'auth'); return; }
    if (!(await ownsCar(this.env, m.token, m.car))) { this.send(ws, { t: 'err', e: 'car' }); ws.close(4004, 'car'); return; }
    // the same account again (a second tab): the older connection leaves
    for (const [w, q] of this.players) if (q.uid === uid) { this.send(w, { t: 'err', e: 'elsewhere' }); w.close(4005, 'elsewhere'); this.leave(w); }
    // a private room's player limit: set by whoever creates it (while it is empty), kept for the others
    const room = await this.roomName();
    if (this.max === undefined) this.max = (await this.ctx.storage.get('max')) || MAX_PLAYERS;
    if (/^p-/.test(room) && m.create === true && !this.players.size) {
      this.max = Math.min(MAX_PLAYERS, Math.max(2, Number.isInteger(m.max) ? m.max : MAX_PLAYERS));
      await this.ctx.storage.put('max', this.max);
    }
    if (!/^p-/.test(room)) this.max = MAX_PLAYERS;
    if (this.players.size >= this.max) { this.send(ws, { t: 'err', e: 'full' }); ws.close(4009, 'full'); return; }
    const id = crypto.randomUUID().slice(0, 8);
    const neon = await neonOf(this.env, m.token, m.neon);
    const p = { id, uid, name, car: m.car, neon, state: null, win: 0, cnt: 0 };
    ws.serializeAttachment({ id, uid, name, car: m.car, neon });
    this.players.set(ws, p);
    this.send(ws, { t: 'welcome', id, room, max: this.max, players: [...this.players.values()].filter(q => q.id !== id).map(q => this.pub(q)) });
    this.others(ws, { t: 'join', p: this.pub(p) });
    this.report();
  }
  leave(ws) {
    const p = this.players.get(ws);
    if (!p) return;
    this.players.delete(ws);
    this.others(ws, { t: 'leave', id: p.id });
    this.report();
  }
  async webSocketClose(ws) { this.leave(ws); }
  async webSocketError(ws) { this.leave(ws); }
  // sockets that never introduced themselves; and the lobby's count kept fresh while people play
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) if (!this.players.has(ws)) { try { ws.close(4001, 'hello first'); } catch (e) { /* gone */ } }
    this.report();
    if (this.players.size) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  async report() {
    const room = await this.roomName();
    if (!/^k1-/.test(room)) return;
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
    await lobby.fetch('https://lobby/count', { method: 'POST', body: JSON.stringify({ room, n: this.players.size }) }).catch(() => {});
  }
}
