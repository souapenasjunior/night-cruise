// Database tests: runs every migration on an in-process PostgreSQL (PGlite) that imitates what matters of
// Supabase (the anon / authenticated roles with Supabase's default grants, auth.users, auth.uid(),
// auth.jwt()), then checks the rules as a player would meet them: what each role can read and write,
// and what the server-side functions accept. Run: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const db = await PGlite.create({ extensions: { citext } });

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create schema extensions;
  grant usage on schema public, auth, extensions to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}',
    raw_app_meta_data jsonb not null default '{}',
    created_at timestamptz not null default now()
  );
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  -- Supabase Storage, the parts the migrations use
  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null);
  alter table storage.objects enable row level security;
  grant select on storage.objects to anon, authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant execute on function storage.foldername(text) to anon, authenticated;
  -- Supabase's defaults: everything new in public is fully granted to the API roles
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

const migDir = join(here, '..', 'migrations');
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(migDir, f), 'utf8'));

// ------------------------------------------------------------------ helpers
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ok  ' + msg); } else { failed++; console.log('  FAIL ' + msg); } };
const now = () => Math.floor(Date.now() / 1000);

// run `fn(tx)` as a role with the given JWT claims, like a request through the Data API
async function as(role, claims, fn) {
  return db.transaction(async tx => {
    await tx.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify(claims || {})]);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}
const player = (id, extra = {}) => ['authenticated', { sub: id, role: 'authenticated', ...extra }];
const fails = async (p, re, msg) => {
  try { await p; ok(false, msg + ' (did not fail)'); } catch (e) { ok(re.test(e.message) || re.test(e.code || ''), `${msg} (${e.code || ''} ${e.message})`); }
};
const signUp = async (email, meta) => (await db.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, meta || {}])).rows[0].id;
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

// ------------------------------------------------------------------ sign-up
console.log('sign-up');
const a = await signUp('a@test', { username: 'Kaiju_Driver' });
const b = await signUp('b@test', { username: 'kaiju_driver' }); // same name, other case
const c = await signUp('c@test', { username: 'x' });            // invalid
const d = await signUp('d@test', { username: 'NightCruiseAdmin' }); // reserved
const pa = await one('select * from public.profiles where id = $1', [a]);
ok(pa && pa.username === 'Kaiju_Driver', 'profile created with the chosen username');
ok((await one('select username from public.profiles where id = $1', [b])).username.startsWith('kaiju_driver_'), 'taken name (case-insensitive) gets a free variant');
ok((await one('select username from public.profiles where id = $1', [c])).username.startsWith('driver_'), 'invalid name falls back to driver_xxxxxx');
ok((await one('select username from public.profiles where id = $1', [d])).username.startsWith('driver_'), 'reserved name refused');
ok(!!(await one('select * from public.player_stats where user_id = $1', [a])), 'stats row created');
ok((await one('select count(*)::int n from public.car_unlocks where user_id = $1', [a])).n === 3, 'the 3 playable cars unlocked by default');

// ------------------------------------------------------------------ anonymous visitor
console.log('anonymous');
await as('anon', {}, async tx => {
  ok((await tx.query('select * from public.cars')).rows.length === 10, 'anon reads the car catalogue (3 free + 7 premium)');
  ok((await tx.query("select price_coins from public.cars where id = 'p_r34'")).rows[0].price_coins === 60000, 'anon reads the car prices (yen)');
  ok((await tx.query("select 1 from public.cars where price_coins is null")).rows.length === 3, 'the free cars are not for sale');
});
await fails(as('anon', {}, tx => tx.query('select * from public.profiles')), /permission denied/, 'anon cannot read profiles');
await fails(as('anon', {}, tx => tx.query("select public.set_username('hacker')")), /permission denied/, 'anon cannot call set_username');
await fails(as('anon', {}, tx => tx.query('select public.delete_my_account()')), /permission denied/, 'anon cannot call delete_my_account');
await as('anon', {}, async tx => {
  ok((await tx.query("select public.username_available('Kaiju_Driver') v")).rows[0].v === false, 'username_available: taken');
  ok((await tx.query("select public.username_available('KAIJU_DRIVER') v")).rows[0].v === false, 'username_available: taken in any case');
  ok((await tx.query("select public.username_available('fresh_name') v")).rows[0].v === true, 'username_available: free');
  ok((await tx.query("select public.username_available('a b') v")).rows[0].v === false, 'username_available: invalid');
});
await fails(as('anon', {}, tx => tx.query('select public.handle_new_user()')), /permission denied|trigger/, 'nobody calls the sign-up trigger function');

// ------------------------------------------------------------------ reading
console.log('reading');
await as(...player(a), async tx => {
  const rows = (await tx.query('select id from public.profiles')).rows;
  ok(rows.length === 1 && rows[0].id === a, 'a player sees only their own profile');
  ok((await tx.query('select * from public.player_stats')).rows.length === 1, 'and only their own stats');
});
await as(...player(a, { app_metadata: { role: 'admin' } }), async tx => {
  ok((await tx.query('select id from public.profiles')).rows.length === 4, 'an admin (role in app_metadata) sees every profile');
});

// ------------------------------------------------------------------ writing
console.log('writing');
await as(...player(a), tx => tx.query(`update public.profiles set settings = '{"audio":{"master":0.5}}', selected_car = 'nsx' where id = $1`, [a]));
const pa2 = await one('select settings, selected_car, settings_updated_at from public.profiles where id = $1', [a]);
ok(pa2.settings.audio.master === 0.5 && pa2.selected_car === 'nsx' && pa2.settings_updated_at, 'player updates own settings and car (server stamps the time)');
await fails(as(...player(a), tx => tx.query(`update public.profiles set settings = '{"x":2}' where id = $1`, [a])), /too_frequent/, 'a burst of settings writes is refused');
await fails(as(...player(a), tx => tx.query(`update public.profiles set username = 'direct' where id = $1`, [a])), /permission denied/, 'username cannot be written directly');
await fails(as(...player(a), tx => tx.query(`update public.profiles set created_at = now() - interval '9 years' where id = $1`, [a])), /permission denied/, 'protected columns cannot be written');
await fails(as(...player(a), tx => tx.query(`update public.profiles set selected_car = 'formula06' where id = $1`, [a])), /foreign key|violates/, 'unknown car id refused');
await db.query("update public.profiles set settings_updated_at = now() - interval '5 seconds' where id = $1", [a]);
await fails(as(...player(a), tx => tx.query(`update public.profiles set settings = $2::jsonb where id = $1`, [a, JSON.stringify({ big: 'x'.repeat(20000) })])), /settings_size/, 'oversized settings refused');
await fails(as(...player(a), tx => tx.query(`update public.profiles set settings = '[1,2]' where id = $1`, [a])), /settings_is_object/, 'settings must be an object');
const bBefore = await one('select settings from public.profiles where id = $1', [b]);
await as(...player(a), tx => tx.query(`update public.profiles set settings = '{"pwn":1}' where id = $1`, [b]));
ok(JSON.stringify((await one('select settings from public.profiles where id = $1', [b])).settings) === JSON.stringify(bBefore.settings), "another player's profile cannot be changed");
await fails(as(...player(a), tx => tx.query('update public.player_stats set distance_m = 999999999 where user_id = $1', [a])), /permission denied/, 'stats cannot be written directly');
await fails(as(...player(a), tx => tx.query("insert into public.car_unlocks (user_id, car_id) values ($1, 'r32')", [a])), /permission denied/, 'unlocks cannot be inserted directly');
await fails(as(...player(a), tx => tx.query("insert into public.records (user_id, kind, value) values ($1, 'lap', 1)", [a])), /permission denied/, 'records cannot be inserted directly');
await fails(as(...player(a), tx => tx.query("insert into public.player_achievements (user_id, achievement_id) values ($1, 'x')", [a])), /permission denied/, 'achievements cannot be inserted directly');
await fails(as(...player(a), tx => tx.query('delete from public.profiles where id = $1', [a])), /permission denied/, 'profiles cannot be deleted directly');

// ------------------------------------------------------------------ username
console.log('username');
await as(...player(c), tx => tx.query("select public.set_username('Night_Owl')"));
ok((await one('select username from public.profiles where id = $1', [c])).username === 'Night_Owl', 'set_username changes the name');
await fails(as(...player(c), tx => tx.query("select public.set_username('Other_Name')")), /username_cooldown/, 'only once a day');
await fails(as(...player(d), tx => tx.query("select public.set_username('night_owl')")), /username_taken/, 'taken names refused (case-insensitive)');
await fails(as(...player(d), tx => tx.query("select public.set_username('SuperAdmin')")), /invalid_username/, 'reserved names refused');
await fails(as(...player(d), tx => tx.query("select public.set_username('<script>')")), /invalid_username/, 'invalid characters refused');

// ------------------------------------------------------------------ drives
console.log('drives');
const sid = (await as(...player(a), tx => tx.query("select public.start_drive('r32') id"))).rows[0].id;
ok(!!sid, 'start_drive returns a drive id');
await fails(as(...player(a), tx => tx.query("select public.start_drive('r32')")), /too_frequent/, 'drives cannot be started in a burst');
await fails(as(...player(a), tx => tx.query('select * from public.report_drive($1, 100, 3)', [sid])), /too_frequent/, 'a report right after the start is refused');
await db.query("update public.drive_sessions set last_report_at = now() - interval '60 seconds' where id = $1", [sid]);
let r = (await as(...player(a), tx => tx.query('select * from public.report_drive($1, 2400, 60)', [sid]))).rows[0];
ok(r.accepted === true && Number(r.total_distance_m) === 2400 && Number(r.total_play_time_s) === 60, 'a plausible report is counted (2.4 km in 60 s)');
await db.query("update public.drive_sessions set last_report_at = now() - interval '60 seconds' where id = $1", [sid]);
r = (await as(...player(a), tx => tx.query('select * from public.report_drive($1, 50000, 60)', [sid]))).rows[0];
ok(r.accepted === false && Number(r.total_distance_m) === 2400, 'an impossible report (50 km in 60 s) is not counted');
await db.query("update public.drive_sessions set last_report_at = now() - interval '60 seconds' where id = $1", [sid]);
r = (await as(...player(a), tx => tx.query('select * from public.report_drive($1, 100, 3600)', [sid]))).rows[0];
ok(r.accepted === false, 'claiming more time than has passed is not counted');
ok((await one('select rejected_reports n from public.player_stats where user_id = $1', [a])).n === 2, 'rejected reports are tallied');
await db.query("update public.drive_sessions set last_report_at = now() - interval '60 seconds' where id = $1", [sid]);
await fails(as(...player(a), tx => tx.query('select * from public.report_drive($1, -5, 10)', [sid])), /invalid_report/, 'negative values refused');
await db.query("update public.drive_sessions set last_report_at = now() - interval '60 seconds' where id = $1", [sid]);
await fails(as(...player(b), tx => tx.query('select * from public.report_drive($1, 100, 10)', [sid])), /unknown_drive/, "a player cannot report on someone else's drive");
await db.query("insert into public.cars (id, name, unlocked_by_default) values ('secret', 'Secret', false)");
await db.query("update public.drive_sessions set started_at = now() - interval '1 minute' where user_id = $1", [a]);
await fails(as(...player(a), tx => tx.query("select public.start_drive('secret')")), /car_locked/, 'a locked car cannot be driven for stats');
ok((await one('select drives from public.player_stats where user_id = $1', [a])).drives === 1, 'drive count kept by the server');

// ------------------------------------------------------------------ yen (in-game currency)
console.log('yen');
const coinsOf = async u => Number((await one('select coins from public.player_stats where user_id = $1', [u])).coins);
const owns = async (u, car) => !!(await one('select 1 x from public.car_unlocks where user_id = $1 and car_id = $2', [u, car]));
ok(await coinsOf(a) === 240, 'driving pays: 2.4 km accepted = ¥240 (¥1 per 10 m)');
ok(await coinsOf(b) === 0, 'rejected reports pay nothing');
// cruise bonus: this drive has been going for an hour
await db.query("update public.drive_sessions set play_time_s = 3600, last_report_at = now() - interval '60 seconds' where id = $1", [sid]);
r = (await as(...player(a), tx => tx.query('select * from public.report_drive($1, 1000, 60)', [sid]))).rows[0];
ok(r.accepted === true && r.earned === 200 && Number(r.bonus) === 2 && Number(r.coins) === 440, 'cruise bonus: after an hour of driving 1 km pays ¥200 (x2)');
await fails(as(...player(a), tx => tx.query('update public.player_stats set coins = 999999 where user_id = $1', [a])), /permission denied/, 'the balance cannot be written directly');
ok(!(await owns(c, 'p_s15')), 'premium cars are locked for a new player');
await fails(as('anon', {}, tx => tx.query("select public.buy_car('p_s15')")), /permission denied/, 'visitors cannot buy');
await fails(as(...player(c), tx => tx.query("select public.buy_car('p_s15')")), /not_enough_coins/, 'a car costs yen the player must have');
await db.query('update public.player_stats set coins = 100000 where user_id = $1', [c]);
const left = (await as(...player(c), tx => tx.query("select public.buy_car('p_s15') v"))).rows[0].v;
ok(Number(left) === 65000 && await owns(c, 'p_s15') && !(await owns(c, 'p_r34')), 'buying one car takes its price (¥35.000) and unlocks only that car');
await fails(as(...player(c), tx => tx.query("select public.buy_car('p_s15')")), /already_owned/, 'no buying the same car twice');
await fails(as(...player(c), tx => tx.query("select public.buy_car('r32')")), /not_for_sale/, 'the free cars are not for sale');
await fails(as(...player(c), tx => tx.query("select public.buy_car('nope')")), /not_for_sale/, 'unknown cars are not for sale');
ok(await coinsOf(c) === 65000, 'refused purchases cost nothing');
await db.query("update public.drive_sessions set started_at = now() - interval '1 minute'");
ok(!!(await as(...player(c), tx => tx.query("select public.start_drive('p_s15') id"))).rows[0].id, 'a bought car can be driven for stats');
ok(!(await one("select 1 x from pg_proc where proname like 'shop_%'")) && !(await one("select 1 x from pg_tables where tablename in ('orders', 'products')")), 'no real-money shop left in the database');

// ------------------------------------------------------------------ premium files (Storage)
console.log('premium files');
ok((await one("select public from storage.buckets where id = 'premium'")).public === false, 'the premium bucket is private');
await db.query("insert into storage.objects (bucket_id, name) values ('premium', 'p_r34/p_r34.json'), ('premium', 'p_rx7/p_rx7.json')");
// (every car turns in 3D on the car select, locked ones too, and online players draw each other's cars:
// anyone may read the files; driving one still needs owning it)
await as(...player(a), async tx => { ok((await tx.query("select 1 from storage.objects where bucket_id = 'premium'")).rows.length === 2, 'a signed-in player can read the premium car files (to see other players\' cars online)'); });
await as('anon', {}, async tx => { ok((await tx.query("select 1 from storage.objects where bucket_id = 'premium'")).rows.length === 2, 'visitors read them too (the car select shows locked cars in 3D)'); });
await db.query("update public.drive_sessions set started_at = now() - interval '1 minute' where user_id = $1", [a]);
await fails(as(...player(a), tx => tx.query("select public.start_drive('p_r34')")), /car_locked/, 'reading the files does not let anyone drive a car they do not own');

// ------------------------------------------------------------------ friends
console.log('friends');
const call = (u, sql, p) => as(...player(u), tx => tx.query(sql, p));
const friendsOf = async u => (await call(u, 'select * from public.my_friends()')).rows;
const dName = (await one('select username from public.profiles where id = $1', [d])).username;
ok((await call(a, "select public.friend_request('night_owl') v")).rows[0].v === 'sent', 'a request by username (any case) is sent');
ok((await call(a, "select public.friend_request('Night_Owl') v")).rows[0].v === 'already_sent', 'asking twice changes nothing');
let fa = await friendsOf(a), fc = await friendsOf(c);
ok(fa.length === 1 && fa[0].status === 'outgoing' && fa[0].username === 'Night_Owl', 'the sender sees it as sent');
ok(fc.length === 1 && fc[0].status === 'incoming' && fc[0].id === a, 'the other player sees it as a request');
await fails(call(a, 'select public.friend_respond($1, true)', [c]), /request_not_found/, 'the sender cannot accept their own request');
await fails(call(a, "select public.friend_request('Kaiju_Driver')"), /cannot_add_self/, 'no adding yourself');
await fails(call(a, "select public.friend_request('nobody_here')"), /user_not_found/, 'unknown names are refused');
await fails(call(a, "select public.friend_request('x''; drop table x;--')"), /user_not_found/, 'odd input is refused');
await call(c, 'select public.heartbeat($1, $2, $3)', ['drive', 'p-ABC123', 'r32']);
ok(!(await friendsOf(a))[0].online && (await friendsOf(a))[0].room === null, 'before accepting, nothing about where they are is shown');
await call(c, 'select public.friend_respond($1, true)', [a]);
fa = await friendsOf(a);
ok(fa[0].status === 'friend' && fa[0].online === true && fa[0].activity === 'drive' && fa[0].room === 'p-ABC123' && fa[0].car === 'r32', 'friends see each other online: driving, room and car');
await db.query("update public.presence set seen_at = now() - interval '5 minutes' where user_id = $1", [c]);
fa = await friendsOf(a);
ok(fa[0].online === false && fa[0].room === null && !!fa[0].last_seen, 'no heartbeat for 2 minutes: offline (last seen kept)');
await call(c, 'select public.heartbeat($1, $2, $3)', ['hack', 'evil room', 'nope']);
ok(JSON.stringify(await one('select activity, room, car from public.presence where user_id = $1', [c])) === JSON.stringify({ activity: 'menu', room: null, car: null }), 'heartbeat cleans what it does not accept');
await call(c, 'select public.go_offline()');
ok((await friendsOf(a))[0].online === false, 'leaving the game shows offline at once');
ok((await call(d, 'select * from public.my_friends()')).rows.length === 0, 'a stranger sees nothing of them');
await fails(call(d, "insert into public.friendships (a, b, requested_by) values ($1, $2, $1)", [a < d ? a : d, a < d ? d : a]), /permission denied/, 'friendships cannot be written directly');
await fails(call(d, 'select * from public.presence'), /permission denied/, 'presence cannot be read directly');
await fails(as('anon', {}, tx => tx.query('select * from public.my_friends()')), /permission denied/, 'visitors have no friends list');
// a request both ways becomes a friendship; declining removes a request
await call(d, 'select public.friend_request($1)', ['Kaiju_Driver']);
ok((await call(a, 'select public.friend_request($1) v', [dName])).rows[0].v === 'accepted', 'asking someone who already asked you makes you friends');
await call(d, 'select public.friend_remove($1)', [a]);
ok(!(await friendsOf(a)).some(f => f.id === d), 'unfriending removes it for both');
await call(d, "select public.friend_request('Night_Owl')");
await call(c, 'select public.friend_respond($1, false)', [d]);
ok((await friendsOf(c)).every(f => f.id !== d), 'a declined request is gone');
await call(b, "select public.friend_request('Kaiju_Driver')");

// ------------------------------------------------------------------ account deletion
console.log('account deletion');
await fails(as(...player(b), tx => tx.query('select public.delete_my_account()')), /reauthentication_needed/, 'deletion needs a recent password');
await fails(as(...player(b, { amr: [{ method: 'password', timestamp: now() - 7200 }] }), tx => tx.query('select public.delete_my_account()')), /reauthentication_needed/, 'a login from 2 hours ago is not enough');
await as(...player(b, { amr: [{ method: 'password', timestamp: now() - 30 }] }), tx => tx.query('select public.delete_my_account()'));
ok(!(await one('select 1 x from auth.users where id = $1', [b])), 'account deleted');
ok(!(await one('select 1 x from public.profiles where id = $1', [b])) && !(await one('select 1 x from public.player_stats where user_id = $1', [b])), 'and all of its data with it');
ok(!!(await one('select 1 x from auth.users where id = $1', [a])), 'other accounts untouched');
ok(!(await friendsOf(a)).some(f => f.id === b), "a deleted account leaves its friends' lists");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
