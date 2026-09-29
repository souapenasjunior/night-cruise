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
  ok((await tx.query('select * from public.cars')).rows.length === 3, 'anon reads the car catalogue');
});
await fails(as('anon', {}, tx => tx.query('select * from public.profiles')), /permission denied/, 'anon cannot read profiles');
await fails(as('anon', {}, tx => tx.query("select public.set_username('hacker')")), /permission denied/, 'anon cannot call set_username');
await fails(as('anon', {}, tx => tx.query('select public.delete_my_account()')), /permission denied/, 'anon cannot call delete_my_account');
await as('anon', {}, async tx => {
  ok((await tx.query("select public.username_available('Kaiju_Driver') v")).rows[0].v === false, 'username_available: taken');
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

// ------------------------------------------------------------------ account deletion
console.log('account deletion');
await fails(as(...player(b), tx => tx.query('select public.delete_my_account()')), /reauthentication_needed/, 'deletion needs a recent password');
await fails(as(...player(b, { amr: [{ method: 'password', timestamp: now() - 7200 }] }), tx => tx.query('select public.delete_my_account()')), /reauthentication_needed/, 'a login from 2 hours ago is not enough');
await as(...player(b, { amr: [{ method: 'password', timestamp: now() - 30 }] }), tx => tx.query('select public.delete_my_account()'));
ok(!(await one('select 1 x from auth.users where id = $1', [b])), 'account deleted');
ok(!(await one('select 1 x from public.profiles where id = $1', [b])) && !(await one('select 1 x from public.player_stats where user_id = $1', [b])), 'and all of its data with it');
ok(!!(await one('select 1 x from auth.users where id = $1', [a])), 'other accounts untouched');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
