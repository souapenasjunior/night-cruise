// Player accounts (Supabase Auth + Postgres, see supabase/ and docs/BACKEND.md).
// Optional: with no project configured below the game shows no account UI and plays exactly as before;
// signed out, it plays as before too. Signed in, the player can play online and the synced settings
// follow them to any device. The profile is kept simple: name, password, sign out, delete.
// The browser holds only the public project URL and anon key: what they allow is decided by Row Level
// Security and the database functions, never by this file.
import { t, onLangChange } from './i18n.js';
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
let S = null;             // the game's settings object
let hooks = {};           // { settingsApplied(), changed(), signedIn() }
let applying = false;     // applying remote settings: the resulting save is not uploaded back
let view = 'login';
let pendingNotice = null; // message to show after returning from an e-mail link

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
  sb.auth.onAuthStateChange((event, session) => { setTimeout(() => onAuth(event, session), 0); });
  if (pendingNotice && pendingNotice !== 'acc.confirmed') { history.replaceState(null, '', location.pathname + location.search); openAccount('login', t(pendingNotice)); pendingNotice = null; }
  SET.onSave(() => { if (user && !applying) scheduleSettingsUpload(); });
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
  if (!user) profile = null;
  render();
  if (hooks.changed) hooks.changed();
}

async function loadProfile() {
  if (!user) return;
  const p = await sb.from('profiles').select('username, created_at, settings, settings_updated_at').eq('id', user.id).maybeSingle();
  if (!p.error) profile = p.data;
}

// ------------------------------------------------------------------ signed-in player
export const isSignedIn = () => !!user;
// the current access token (online: the room checks it with Supabase's public keys)
export async function accessToken() {
  if (!sb || !user) return null;
  const { data } = await sb.auth.getSession();
  return data && data.session ? data.session.access_token : null;
}
export const myName = () => (profile ? profile.username : '');

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
  // (the title's yen card shows the name: main.js renders it on hooks.changed)
  if ($('account').hidden) return;
  if (!user && (view === 'profile')) view = 'login';
  for (const el of $('account').querySelectorAll('[data-view]')) el.hidden = el.dataset.view !== view;
  $('acct-title').textContent = t('acc.title.' + view);
  $('acct-sub').textContent = user && user.email ? user.email : '';
  const form = $('account').querySelector(`[data-view="${view}"]`);
  if (form && form.tagName === 'FORM') prepareCaptcha(form);
  $('account').classList.toggle('pf', view === 'profile');
  if (view === 'profile' && profile) {
    const name = profile.username || '';
    $('pf-name').textContent = name;
    const av = $('pf-avatar');
    av.textContent = (name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?');
    let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    av.style.setProperty('--a1', `hsl(${h % 360} 85% 55%)`);
    av.style.setProperty('--a2', `hsl(${(h >> 8) % 360} 75% 40%)`);
    $('pf-username').value = name;
    $('pf-since').textContent = profile.created_at ? new Date(profile.created_at).toLocaleDateString(t('acc.locale'), { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  }
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
    // signed in: the panel gets out of the way
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
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    $('dl-name').value = '';
    show('login');
    say(t('acc.deleted'));
  }); };
}
