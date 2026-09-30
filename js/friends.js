// Friends: add players by username, answer requests, and see who is online and what they are doing (in
// the menus, driving, in which online room, so you can join them). The rules live in the database
// (supabase/migrations/*_friends.sql): the game only calls its functions as the signed-in player.
//   heartbeat(activity, room, car)  about every 45 s while the game is open (and when that changes)
//   my_friends()                    the list, re-read every 30 s while signed in
import { t } from './i18n.js';
import { backend, exitRequest, isSignedIn } from './account.js';

const $ = id => document.getElementById(id);
const BEAT_EVERY = 45000, LIST_EVERY = 30000;
let hooks = {};          // { presence() -> { activity, room, car }, carName(id), roomLabel(room), join(room), toast(msg), changed() }
let list = [];           // rows from my_friends()
let loaded = false;      // (the first load does not toast "X is online")
let beatAt = 0, lastBeat = '', listAt = 0, busy = false;
let confirmRemove = null;
let lastHtml = '';

export const isFriendsOpen = () => !$('friends').hidden;
export const friendsBadge = () => list.filter(f => f.status === 'incoming' || (f.status === 'friend' && f.online)).length;

export function initFriends(h) {
  hooks = h || {};
  $('fr-close').onclick = closeFriends;
  $('fr-add').onsubmit = e => { e.preventDefault(); addFriend(); };
  $('fr-name').oninput = () => { $('fr-name').value = $('fr-name').value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20); };
  $('fr-list').onclick = e => {
    const b = e.target.closest('button[data-act]');
    if (b) act(b.dataset.act, b.dataset.id, b.dataset.room);
  };
  window.addEventListener('pagehide', () => exitRequest('go_offline'));
  setInterval(tick, 5000);
}

// signed in / out, or something the friends see changed (a drive started, an online room joined)
export function friendsChanged() {
  beatAt = 0;
  if (!isSignedIn()) { list = []; loaded = false; lastBeat = ''; render(); return; }
  tick();
}

async function tick() {
  const sb = backend();
  if (!sb || busy) return;
  const now = Date.now();
  const p = hooks.presence ? hooks.presence() : { activity: 'menu', room: null, car: null };
  const sig = JSON.stringify(p);
  busy = true;
  try {
    // (what changed goes out within ~10 s; otherwise once every 45 s)
    if (now - beatAt > BEAT_EVERY || (sig !== lastBeat && now - beatAt > 10000)) {
      beatAt = now; lastBeat = sig;
      await sb.rpc('heartbeat', { p_activity: p.activity, p_room: p.room, p_car: p.car });
    }
    if (now - listAt > (isFriendsOpen() ? 10000 : LIST_EVERY)) { listAt = now; await load(); }
  } catch (e) { /* offline: next time */ } finally { busy = false; }
}

async function load() {
  const sb = backend();
  if (!sb) return;
  const { data, error } = await sb.rpc('my_friends');
  if (error || !Array.isArray(data)) return;
  // news since the last look: a friend came online, a new request arrived
  if (loaded && hooks.toast) {
    const before = new Map(list.map(f => [f.id, f]));
    for (const f of data) {
      const o = before.get(f.id);
      if (f.status === 'friend' && f.online && !(o && o.online)) hooks.toast(t('fr.cameOnline', { name: f.username }));
      else if (f.status === 'incoming' && !o) hooks.toast(t('fr.newRequest', { name: f.username }));
      else if (f.status === 'friend' && o && o.status === 'outgoing') hooks.toast(t('fr.accepted', { name: f.username }));
    }
  }
  list = data;
  loaded = true;
  render();
  if (hooks.changed) hooks.changed();
}

export function openFriends() {
  $('friends').hidden = false;
  $('fr-msg').textContent = '';
  confirmRemove = null;
  render();
  listAt = 0; tick();
  setTimeout(() => $('fr-name').focus(), 30);
}
export function closeFriends() {
  $('friends').hidden = true;
  if (hooks.closed) hooks.closed();
}
const say = (msg, bad) => { $('fr-msg').textContent = msg; $('fr-msg').classList.toggle('bad', !!bad); };

async function addFriend() {
  const sb = backend();
  const name = $('fr-name').value.trim();
  if (!sb) return;
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) { say(t('fr.badName'), true); return; }
  say(t('acc.wait'));
  const { data, error } = await sb.rpc('friend_request', { p_username: name });
  if (error) {
    const m = error.message || '';
    say(t(/user_not_found/.test(m) ? 'fr.err.notFound' : /cannot_add_self/.test(m) ? 'fr.err.self' : /too_many_requests/.test(m) ? 'fr.err.tooManyReq' : /too_many_friends/.test(m) ? 'fr.err.tooMany' : 'acc.err.generic', { name }), true);
    return;
  }
  $('fr-name').value = '';
  say(t('fr.res.' + data, { name }));
  await load();
}

async function act(what, id, room) {
  const sb = backend();
  if (!sb) return;
  if (what === 'join') { closeFriends(); if (hooks.join) hooks.join(room); return; }
  if (what === 'remove' && confirmRemove !== id) { confirmRemove = id; render(); return; }
  confirmRemove = null;
  const { error } = what === 'accept' || what === 'decline'
    ? await sb.rpc('friend_respond', { p_other: id, p_accept: what === 'accept' })
    : await sb.rpc('friend_remove', { p_other: id });
  if (error) say(t('acc.err.generic'), true);
  else say('');
  await load();
}

// "seen 3 h ago"
function ago(iso) {
  if (!iso) return t('fr.never');
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return t('fr.agoMin', { n: m });
  if (m < 60 * 48) return t('fr.agoH', { n: Math.round(m / 60) });
  return t('fr.agoD', { n: Math.round(m / 1440) });
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function avatar(name) {
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<i class="fr-av" style="--a1:hsl(${h % 360} 85% 55%);--a2:hsl(${(h >> 8) % 360} 75% 40%)">${esc(name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?')}</i>`;
}
function doing(f) {
  const car = f.car && hooks.carName ? hooks.carName(f.car) : '';
  if (f.room) return t('fr.inRoom', { room: hooks.roomLabel ? hooks.roomLabel(f.room) : f.room }) + (car ? ' · ' + esc(car) : '');
  if (f.activity === 'drive') return t('fr.driving') + (car ? ' · ' + esc(car) : '');
  return t('fr.inMenu');
}

function render() {
  const btn = $('btn-friends'), pbtn = $('p-friends');
  const signed = isSignedIn();
  btn.hidden = pbtn.hidden = !signed;
  const n = friendsBadge();
  for (const b of [btn, pbtn]) { b.dataset.badge = n ? String(n) : ''; }
  if ($('friends').hidden) return;
  const inc = list.filter(f => f.status === 'incoming');
  const out = list.filter(f => f.status === 'outgoing');
  const on = list.filter(f => f.status === 'friend' && f.online).sort((a, b) => a.username.localeCompare(b.username));
  const off = list.filter(f => f.status === 'friend' && !f.online).sort((a, b) => Date.parse(b.last_seen || 0) - Date.parse(a.last_seen || 0));
  const rm = f => `<button class="btn small fr-x${confirmRemove === f.id ? ' sure' : ''}" data-act="remove" data-id="${f.id}" title="${esc(t('fr.remove'))}">${confirmRemove === f.id ? esc(t('fr.removeSure')) : '✕'}</button>`;
  let html = '';
  if (inc.length) {
    html += `<h3>${t('fr.requests')} <b>${inc.length}</b></h3>`;
    for (const f of inc) html += `<div class="fr-row">${avatar(f.username)}<div class="fr-who"><b>${esc(f.username)}</b><span>${t('fr.wantsYou')}</span></div><div class="fr-acts"><button class="btn small go" data-act="accept" data-id="${f.id}">${t('fr.accept')}</button><button class="btn small" data-act="decline" data-id="${f.id}">${t('fr.decline')}</button></div></div>`;
  }
  html += `<h3>${t('fr.online')} <b>${on.length}</b></h3>`;
  if (!on.length) html += `<p class="fr-empty">${t(list.some(f => f.status === 'friend') ? 'fr.noneOnline' : 'fr.noFriends')}</p>`;
  for (const f of on) {
    const join = f.room ? `<button class="btn small go" data-act="join" data-id="${f.id}" data-room="${esc(f.room)}">${t('fr.join')}</button>` : '';
    html += `<div class="fr-row on">${avatar(f.username)}<div class="fr-who"><b><i class="fr-dot"></i>${esc(f.username)}</b><span>${doing(f)}</span></div><div class="fr-acts">${join}${rm(f)}</div></div>`;
  }
  if (off.length) {
    html += `<h3>${t('fr.offline')} <b>${off.length}</b></h3>`;
    for (const f of off) html += `<div class="fr-row off">${avatar(f.username)}<div class="fr-who"><b>${esc(f.username)}</b><span>${t('fr.seen', { when: ago(f.last_seen) })}</span></div><div class="fr-acts">${rm(f)}</div></div>`;
  }
  if (out.length) {
    html += `<h3>${t('fr.sent')} <b>${out.length}</b></h3>`;
    for (const f of out) html += `<div class="fr-row off">${avatar(f.username)}<div class="fr-who"><b>${esc(f.username)}</b><span>${t('fr.waiting')}</span></div><div class="fr-acts"><button class="btn small" data-act="cancel" data-id="${f.id}">${t('fr.cancel')}</button></div></div>`;
  }
  // (unchanged: left alone, so the focused button keeps its focus)
  if (html !== lastHtml) { lastHtml = html; $('fr-list').innerHTML = html; }
}
