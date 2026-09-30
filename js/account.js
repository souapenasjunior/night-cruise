// Player accounts (Supabase Auth + Postgres, see supabase/ and docs/BACKEND.md).
// Optional: with no project configured below the game shows no account UI and plays exactly as before;
// signed out, it plays as before too. Signed in, the synced settings follow the player and each drive
// reports distance and time, which the server checks before counting (report_drive in the migration).
// The browser holds only the public project URL and anon key: what they allow is decided by Row Level
// Security and the database functions, never by this file.
import { t, onLangChange, num } from './i18n.js';
import * as SET from './settings.js';

// Public configuration (safe to publish). Secrets (service key, SMTP key, captcha secret) never go here.
export const BACKEND = {
  url: 'https://awynkbzkmyybrjbkqdsb.supabase.co',
  anonKey: 'sb_publishable_StGYW7U48omZkK3WNu8v_A_s5m9Nwpl', // publishable key: public by design
  turnstileSiteKey: '0x4AAAAAAFIjnADnPZVjXNaf', // Cloudflare Turnstile site key (public)
};
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
const TURNSTILE_JS = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const accountsEnabled = () => !!(BACKEND.url && BACKEND.anonKey);

const $ = id => document.getElementById(id);
let sb = null;            // Supabase client (loaded on demand)
let user = null;          // signed-in user
let profile = null;       // public.profiles row
let stats = null;         // public.player_stats row
let S = null;             // the game's settings object
let hooks = {};           // { settingsApplied(), changed(), blip() }
let applying = false;     // applying remote settings: the resulting save is not uploaded back
let view = 'login';
let pendingNotice = null; // message to show after returning from an e-mail link
let token = null;         // current access token (kept for the request sent while the page closes)

// ------------------------------------------------------------------ boot
export async function initAccount(settings, h) {
  S = settings;
  hooks = h || {};
  if (!accountsEnabled()) return;
  // coming back from an e-mail link: note what it was before the client consumes the URL
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('error_code')) pendingNotice = hash.get('error_code') === 'otp_expired' ? 'acc.linkExpired' : 'acc.linkInvalid';
  else if (hash.get('type') === 'signup') pendingNotice = 'acc.confirmed';
  try {
    const { createClient } = await import(SUPABASE_JS);
    sb = createClient(BACKEND.url, BACKEND.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (e) {
    console.warn('[account] backend unavailable', e && e.message);
    return; // (no account button then: the game plays as without accounts)
  }
  bindUi();
  $('btn-account').hidden = false;
  // (supabase-js: no awaited calls inside this callback; run them after it returns)
  sb.auth.onAuthStateChange((event, session) => {
    token = session ? session.access_token : null;
    setTimeout(() => onAuth(event, session), 0);
  });
  loadPrices();
  if (pendingNotice && pendingNotice !== 'acc.confirmed') { history.replaceState(null, '', location.pathname + location.search); openAccount('login', t(pendingNotice)); pendingNotice = null; }
  SET.onSave(() => { if (user && !applying) scheduleSettingsUpload(); });
  window.addEventListener('pagehide', flushOnExit);
  onLangChange(() => render());
}

async function onAuth(event, session) {
  const was = user && user.id;
  user = session ? session.user : null;
  if (event === 'PASSWORD_RECOVERY') { openAccount('reset'); return; }
  if (user && user.id !== was) {
    await loadProfile();
    await syncSettingsOnSignIn();
    sb.rpc('touch_last_seen').then(() => {}, () => {});
    if (pendingNotice === 'acc.confirmed') { pendingNotice = null; openAccount('profile', t('acc.confirmed')); }
  }
  if (user) await loadOwned();
  if (!user) { profile = null; stats = null; drive = null; owned = new Set(); }
  render();
  if (hooks.changed) hooks.changed();
}

async function loadProfile() {
  if (!user) return;
  const [p, s] = await Promise.all([
    sb.from('profiles').select('username, created_at, last_seen_at, selected_car, settings, settings_updated_at, username_changed_at').eq('id', user.id).maybeSingle(),
    sb.from('player_stats').select('distance_m, play_time_s, drives, coins, coins_earned').eq('user_id', user.id).maybeSingle(),
  ]);
  if (!p.error) profile = p.data;
  if (!s.error) stats = s.data;
}

// ------------------------------------------------------------------ yen and cars
// There is no real money in the game: players earn yen (¥) by driving and buy cars with it. The balance
// is kept and changed only by the server (report_drive pays for accepted distance, buy_car spends);
// what the player owns comes from car_unlocks (readable only by its owner, written only by the server).
let owned = new Set();
let prices = new Map(); // car id -> price in yen (the catalogue, public)
export const isSignedIn = () => !!user;
// the current access token (online: the room checks it with Supabase's public keys)
export async function accessToken() {
  if (!sb || !user) return null;
  const { data } = await sb.auth.getSession();
  return data && data.session ? data.session.access_token : null;
}
export const myName = () => (profile ? profile.username : '');
// the database functions as the signed-in player (friends.js), or null signed out
export const backend = () => (user && sb ? sb : null);
// for a request sent while the page closes (keepalive fetch): the last known access token
export const exitRequest = (fn, body) => {
  if (!user || !token) return;
  fetch(BACKEND.url + '/rest/v1/rpc/' + fn, {
    method: 'POST', keepalive: true,
    headers: { apikey: BACKEND.anonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).catch(() => {});
};
export const ownsCar = id => owned.has(id);
export const priceOf = id => prices.get(id) || 0;
export const coinBalance = () => (stats ? Number(stats.coins) || 0 : 0);
async function loadOwned() {
  if (!user) return;
  const { data, error } = await sb.from('car_unlocks').select('car_id').eq('user_id', user.id);
  if (!error) owned = new Set(data.map(r => r.car_id));
}
async function loadPrices() {
  const { data, error } = await sb.from('cars').select('id, price_coins').not('price_coins', 'is', null);
  if (!error) { prices = new Map(data.map(r => [r.id, r.price_coins])); if (hooks.changed) hooks.changed(); }
}
// buy one car with yen. Returns null when bought, else a message for the player.
export async function buyCar(carId) {
  if (!sb || !user) return t('coins.signIn');
  const { data, error } = await sb.rpc('buy_car', { p_car: carId });
  if (error) {
    if (/not_enough_coins/.test(error.message)) return t('coins.notEnough');
    if (/already_owned/.test(error.message)) { await loadOwned(); if (hooks.changed) hooks.changed(); return null; }
    return t('acc.err.generic');
  }
  owned.add(carId);
  if (stats) stats.coins = Number(data);
  if (hooks.changed) hooks.changed();
  return null;
}
// while driving: the server balance plus what this drive has earned since the last report (an
// estimate; the server's figure replaces it at every report, once a minute)
export function liveCoins() {
  if (!user || !stats) return null;
  const pending = drive ? Math.floor((drive.dist / 10) * cruiseBonus()) : 0;
  return { balance: coinBalance(), pending, bonus: cruiseBonus() };
}
// cruise bonus of the running drive (same steps as the server: 10 / 30 / 60 minutes)
function cruiseBonus() {
  const s = drive ? drive.total : 0;
  return s >= 3600 ? 2 : s >= 1800 ? 1.5 : s >= 600 ? 1.25 : 1;
}

// Premium car files are in the private Storage bucket 'premium' (one folder per car), readable by
// anyone (the car select turns every car in 3D, locked ones too; online, everyone draws everyone's car;
// driving one needs owning it). Returns Map(file name -> signed URL) or null. The URLs last 7 days and
// are kept in this browser meanwhile, so the same links (and the browser's cache of the files) are reused.
const SIGN_FOR = 7 * 24 * 3600;
export async function premiumFiles(carId) {
  if (!sb) return null;
  const key = `nc.prem.${carId}`;
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && c.until > Date.now() + 3600 * 1000) return new Map(c.files);
  } catch (e) { /* storage unavailable: sign again */ }
  const { data: list, error } = await sb.storage.from('premium').list(carId, { limit: 500 });
  if (error || !list || !list.length) return null;
  const paths = list.map(f => `${carId}/${f.name}`);
  const { data: signed, error: e2 } = await sb.storage.from('premium').createSignedUrls(paths, SIGN_FOR);
  if (e2 || !signed) return null;
  const files = signed.filter(s => s.signedUrl && !s.error).map(s => [s.path.split('/').pop(), s.signedUrl]);
  try { localStorage.setItem(key, JSON.stringify({ until: Date.now() + SIGN_FOR * 1000, files })); } catch (e) { /* fine */ }
  return new Map(files);
}

// ------------------------------------------------------------------ settings sync
// On sign-in the newer copy wins: the account's (from another device) or this browser's.
async function syncSettingsOnSignIn() {
  if (!profile) return;
  const remote = profile.settings || {};
  const remoteAt = profile.settings_updated_at ? Date.parse(profile.settings_updated_at) : 0;
  if (Object.keys(remote).length && remoteAt > (S.savedAt || 0)) {
    applying = true;
    try {
      SET.applySynced(S, remote);
      SET.save(S);
      if (hooks.settingsApplied) hooks.settingsApplied();
    } finally { applying = false; }
  } else {
    uploadSettings();
  }
}
let uploadTimer = 0;
function scheduleSettingsUpload() {
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(uploadSettings, 3000);
}
async function uploadSettings() {
  if (!user || !sb) return;
  const { error } = await sb.from('profiles').update({ settings: SET.syncedPart(S) }).eq('id', user.id);
  if (error && /too_frequent/.test(error.message)) scheduleSettingsUpload();
}

// ------------------------------------------------------------------ drive statistics
// The game reports what it measured; the server decides what counts (report_drive).
let drive = null; // { id, lastOdo, dist, time, sentAt }
const REPORT_EVERY = 60; // s
export async function driveStarted(carId) {
  drive = null;
  if (!user || !sb) return;
  const { data, error } = await sb.rpc('start_drive', { p_car: carId });
  if (!error && data) drive = { id: data, lastOdo: null, dist: 0, time: 0, total: 0, sentAt: performance.now() };
}
// every frame while driving (not while paused): distance from the car's odometer, time from the clock
export function driveTick(dt, odo) {
  if (!drive) return;
  if (drive.lastOdo !== null) {
    const d = odo - drive.lastOdo;
    if (d >= 0 && d < 200) drive.dist += d; // a reset or respawn jumps: not driven
  }
  drive.lastOdo = odo;
  drive.time += dt;
  drive.total += dt;
  if (drive.time >= REPORT_EVERY && !drive.busy) report();
}
export function driveStopped() { if (drive && drive.time >= 1 && !drive.busy) report(); }
async function report() {
  const d = drive;
  if (!d || !user) return;
  if (performance.now() - d.sentAt < 6000) return; // the server refuses reports closer than 5 s apart
  d.busy = true;
  const dist = Math.round(d.dist), time = Math.round(d.time);
  const { data, error } = await sb.rpc('report_drive', { p_session: d.id, p_distance_m: dist, p_seconds: time });
  d.busy = false;
  if (error) {
    if (/unknown_drive/.test(error.message)) drive = null;
    return;
  }
  d.dist -= dist; d.time -= time; d.sentAt = performance.now();
  const row = Array.isArray(data) ? data[0] : data;
  if (row && stats) {
    stats.distance_m = row.total_distance_m; stats.play_time_s = row.total_play_time_s;
    if (row.coins !== undefined) stats.coins = Number(row.coins);
  }
  if (row && row.earned > 0 && hooks.earned) hooks.earned(row.earned, Number(row.bonus) || 1);
}
// closing the tab: send what is left with a request that survives the page
function flushOnExit() {
  const d = drive;
  if (!d || !user || !token || d.time < 1 || performance.now() - d.sentAt < 6000) return;
  exitRequest('report_drive', { p_session: d.id, p_distance_m: Math.round(d.dist), p_seconds: Math.round(d.time) });
}

// ------------------------------------------------------------------ captcha (Cloudflare Turnstile)
let turnstileLoad = null;
function loadTurnstile() {
  if (!BACKEND.turnstileSiteKey) return Promise.resolve(null);
  if (!turnstileLoad) turnstileLoad = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = TURNSTILE_JS; s.async = true;
    s.onload = () => res(window.turnstile); s.onerror = rej;
    document.head.appendChild(s);
  });
  return turnstileLoad;
}
// one widget per form, rendered when the form is shown; its token goes with the request, then it resets
const widgets = new Map();
async function prepareCaptcha(form) {
  const box = form.querySelector('.ts-box');
  if (!box || !BACKEND.turnstileSiteKey) return;
  const ts = await loadTurnstile().catch(() => null);
  if (!ts) return;
  if (!widgets.has(form)) {
    widgets.set(form, ts.render(box, { sitekey: BACKEND.turnstileSiteKey, theme: 'dark', callback: tok => { form.dataset.captcha = tok; } }));
  }
}
function captchaToken(form) { return form.dataset.captcha || undefined; }
function resetCaptcha(form) {
  delete form.dataset.captcha;
  if (widgets.has(form) && window.turnstile) window.turnstile.reset(widgets.get(form));
}

// ------------------------------------------------------------------ UI
export const isAccountOpen = () => !$('account').hidden;
export function openAccount(v, message) {
  if (!sb) return;
  view = v || (user ? 'profile' : 'login');
  $('account').hidden = false;
  render();
  say(message || '');
  if (user && view === 'profile') loadProfile().then(render);
  setTimeout(() => {
    const f = $('account').querySelector(`[data-view="${view}"] input, [data-view="${view}"] button`);
    if (f) f.focus();
  }, 30);
}
export function closeAccount() {
  $('account').hidden = true;
  say('');
  const b = $('btn-account');
  if (b && !$('title').hidden) b.focus();
}
function say(msg, bad) {
  const el = $('acct-msg');
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
}
function show(v) { view = v; render(); say(''); setTimeout(() => { const f = $('account').querySelector(`[data-view="${v}"] input`); if (f) f.focus(); }, 30); }

function render() {
  if (!sb) return;
  const btn = $('btn-account');
  btn.textContent = user ? t('acc.profileBtn') : t('acc.signInBtn');
  const chip = $('title-user');
  chip.hidden = !user || !profile;
  if (profile) $('title-user-name').textContent = profile.username;
  if ($('account').hidden) return;
  if (!user && (view === 'profile')) view = 'login';
  for (const el of $('account').querySelectorAll('[data-view]')) el.hidden = el.dataset.view !== view;
  $('acct-title').textContent = t('acc.title.' + view);
  $('acct-sub').textContent = user && user.email ? user.email : '';
  const form = $('account').querySelector(`[data-view="${view}"]`);
  if (form && form.tagName === 'FORM') prepareCaptcha(form);
  $('account').classList.toggle('pf', view === 'profile');
  if (view === 'profile' && profile) {
    renderPilotCard();
    $('pf-username').value = profile.username;
    const date = iso => (iso ? new Date(iso).toLocaleDateString(t('acc.locale'), { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
    $('pf-since').textContent = date(profile.created_at);
    $('pf-seen').textContent = date(profile.last_seen_at);
    $('pf-dist').textContent = stats ? num(stats.distance_m / 1000, 1) + ' km' : '—';
    const mins = stats ? Math.round(stats.play_time_s / 60) : 0;
    $('pf-time').textContent = stats ? (mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`) : '—';
    $('pf-drives').textContent = stats ? String(stats.drives) : '—';
  }
}

// the profile's driver card: avatar (initials on colours picked from the name), rank by distance driven,
// the garage (every car, the locked ones dimmed) and the last car driven
function renderPilotCard() {
  const name = profile.username || '';
  $('pf-name').textContent = name;
  const av = $('pf-avatar');
  av.textContent = (name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?');
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  av.style.setProperty('--a1', `hsl(${h % 360} 85% 55%)`);
  av.style.setProperty('--a2', `hsl(${(h >> 8) % 360} 75% 40%)`);
  const km = stats ? stats.distance_m / 1000 : 0;
  $('pf-rank').textContent = t(km >= 2000 ? 'acc.rank4' : km >= 500 ? 'acc.rank3' : km >= 50 ? 'acc.rank2' : 'acc.rank1');
  const cars = hooks.cars ? hooks.cars() : [];
  const box = $('pf-cars');
  box.innerHTML = '';
  let have = 0;
  for (const c of cars) {
    const ok = !c.premium || owned.has(c.id);
    if (ok) have++;
    const d = document.createElement('div');
    d.className = 'pf-car' + (ok ? '' : ' off');
    d.textContent = c.short;
    d.title = c.name;
    if (c.color) d.style.borderBottomColor = c.color;
    box.appendChild(d);
  }
  $('pf-garage-count').textContent = `${have}/${cars.length}`;
  const prem = cars.filter(c => c.premium);
  $('pf-premium').hidden = !prem.length || !prem.every(c => owned.has(c.id));
  $('pf-coins').textContent = stats ? '¥ ' + coinBalance().toLocaleString(t('acc.locale')) : '—';
  const fav = cars.find(c => c.id === profile.selected_car);
  $('pf-fav').hidden = !fav;
  if (fav) $('pf-fav-name').textContent = fav.name;
}

// errors from Auth and from the database functions, in the player's language
function errorText(e) {
  const code = (e && (e.code || e.error_code)) || '';
  const m = (e && e.message) || '';
  const pick = [
    [/invalid_credentials|Invalid login credentials/i, 'acc.err.credentials'],
    [/email_not_confirmed|Email not confirmed/i, 'acc.err.notConfirmed'],
    [/weak_password|Password should/i, 'acc.err.weak'],
    [/same_password/i, 'acc.err.samePassword'],
    [/over_.*rate_limit|rate limit|too_frequent|429/i, 'acc.err.rate'],
    [/captcha/i, 'acc.err.captcha'],
    [/username_taken/i, 'acc.err.nameTaken'],
    [/username_cooldown/i, 'acc.err.nameCooldown'],
    [/invalid_username/i, 'acc.err.nameInvalid'],
    [/reauthentication/i, 'acc.err.reauth'],
    [/Failed to fetch|NetworkError|fetch/i, 'acc.err.network'],
  ];
  for (const [re, key] of pick) if (re.test(code) || re.test(m)) return t(key);
  return t('acc.err.generic');
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
function busy(form, on) { for (const el of form.querySelectorAll('button, input')) el.disabled = on; }
async function submit(form, fn) {
  if (form.dataset.busy) return;
  form.dataset.busy = '1';
  busy(form, true);
  say(t('acc.wait'));
  try { await fn(); } catch (e) { say(errorText(e), true); } finally {
    delete form.dataset.busy;
    busy(form, false);
    resetCaptcha(form);
  }
}
const val = id => $(id).value.trim();
const fail = key => { const e = new Error(key); e.code = key; throw e; };

function bindUi() {
  $('btn-account').onclick = () => openAccount();
  $('acct-close').onclick = closeAccount;
  for (const a of $('account').querySelectorAll('[data-go]')) a.onclick = e => { e.preventDefault(); show(a.dataset.go); };

  $('acct-login').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => {
    const { error } = await sb.auth.signInWithPassword({ email: val('li-email'), password: $('li-pass').value, options: { captchaToken: captchaToken(f) } });
    if (error) throw error;
    $('li-pass').value = '';
    // signed in: the panel gets out of the way (the title shows the player's name); the game may pick up
    // what the sign-in was for (the shop)
    closeAccount();
    if (hooks.signedIn) hooks.signedIn();
  }); };

  let checkT = 0;
  $('su-name').oninput = () => {
    clearTimeout(checkT);
    const n = val('su-name'), hint = $('su-name-hint');
    if (!n) { hint.textContent = t('acc.nameRule'); return; }
    if (!USERNAME_RE.test(n)) { hint.textContent = t('acc.nameRule'); return; }
    checkT = setTimeout(async () => {
      const { data, error } = await sb.rpc('username_available', { p_name: n });
      if (!error && val('su-name') === n) hint.textContent = data ? t('acc.nameFree') : t('acc.nameTaken');
    }, 450);
  };
  $('acct-signup').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => {
    const name = val('su-name'), pass = $('su-pass').value;
    if (!USERNAME_RE.test(name)) fail('invalid_username');
    if (pass !== $('su-pass2').value) { say(t('acc.err.mismatch'), true); return; }
    const { error } = await sb.auth.signUp({
      email: val('su-email'), password: pass,
      options: { data: { username: name }, emailRedirectTo: location.origin + location.pathname, captchaToken: captchaToken(f) },
    });
    if (error) throw error;
    $('su-pass').value = $('su-pass2').value = '';
    $('sent-text').textContent = t('acc.sentSignup', { email: val('su-email') });
    show('sent');
  }); };

  $('acct-forgot').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => {
    const { error } = await sb.auth.resetPasswordForEmail(val('fg-email'), { redirectTo: location.origin + location.pathname, captchaToken: captchaToken(f) });
    if (error) throw error;
    $('sent-text').textContent = t('acc.sentReset', { email: val('fg-email') });
    show('sent');
  }); };

  $('acct-reset').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => {
    const pass = $('rs-pass').value;
    if (pass !== $('rs-pass2').value) { say(t('acc.err.mismatch'), true); return; }
    const { error } = await sb.auth.updateUser({ password: pass });
    if (error) throw error;
    $('rs-pass').value = $('rs-pass2').value = '';
    history.replaceState(null, '', location.pathname + location.search);
    show('profile');
    say(t('acc.passChanged'));
  }); };

  $('pf-name-form').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => {
    const n = val('pf-username');
    if (!USERNAME_RE.test(n)) fail('invalid_username');
    if (profile && n === profile.username) { say(''); return; }
    const { error } = await sb.rpc('set_username', { p_name: n });
    if (error) throw error;
    await loadProfile(); render();
    say(t('acc.nameSaved'));
  }); };

  // password change and account deletion ask for the current password (a fresh sign-in): the server
  // also demands it for deletion (delete_my_account checks the login time in the token)
  const reauth = async (form, passId) => {
    const { error } = await sb.auth.signInWithPassword({ email: user.email, password: $(passId).value, options: { captchaToken: captchaToken(form) } });
    $(passId).value = '';
    if (error) throw error;
  };
  $('pf-pass-form').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => {
    const pass = $('pf-new').value;
    if (pass !== $('pf-new2').value) { say(t('acc.err.mismatch'), true); return; }
    await reauth(f, 'pf-cur');
    const { error } = await sb.auth.updateUser({ password: pass });
    $('pf-new').value = $('pf-new2').value = '';
    if (error) throw error;
    say(t('acc.passChanged'));
  }); };

  $('pf-logout').onclick = async () => {
    driveStopped();
    await sb.rpc('go_offline').then(() => {}, () => {}); // (friends see it at once)
    await sb.auth.signOut({ scope: 'local' });
    show('login');
    say(t('acc.signedOut'));
  };
  $('pf-delete').onclick = () => show('delete');
  $('acct-delete').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => {
    if (!profile || val('dl-name') !== profile.username) { say(t('acc.err.deleteName'), true); return; }
    await reauth(f, 'dl-pass');
    const { error } = await sb.rpc('delete_my_account');
    if (error) throw error;
    drive = null;
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    $('dl-name').value = '';
    show('login');
    say(t('acc.deleted'));
  }); };
}
