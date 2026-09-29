-- Night Cruise: player accounts and player data (Supabase / PostgreSQL).
--
-- Who can do what
--   * Sign-up, login, sessions, e-mail confirmation and password reset are Supabase Auth (auth.users).
--     Passwords are hashed by Auth (bcrypt) and never stored or seen here.
--   * The browser talks to the database with the player's JWT through the Data API. Row Level Security
--     decides which rows a player may read; column grants decide what a player may write directly.
--   * A player may only write their own preferences (selected car, synced settings). Everything that
--     counts as progress - distance, play time, unlocks, achievements, records - has no write grant at
--     all: it changes only inside SECURITY DEFINER functions that check the request on the server.
--   * Every function is revoked from PUBLIC and granted to exactly the roles that need it.
--   * Admin: a role in auth.users.raw_app_meta_data (settable only with the service key or SQL), read
--     through public.is_admin(). A future admin site uses the same accounts.
--   * All player rows reference auth.users with ON DELETE CASCADE: deleting the account deletes the data.

create extension if not exists citext with schema extensions;

-- ------------------------------------------------------------------ helpers

create or replace function public.is_admin()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

-- names nobody may take (impersonation of staff / the game)
create or replace function public.username_reserved(name text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select lower(name) ~ '(admin|moderat|nightcruise|night_cruise|staff|support|official|system|root)'
$$;

create or replace function public.username_valid(name text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select name is not null and name ~ '^[A-Za-z0-9_]{3,20}$' and not public.username_reserved(name)
$$;

-- the password (or recovery link / e-mail code) was used in the last `secs` seconds. The `amr` claim keeps
-- the time of the original login across token refreshes, so a long-lived session does not pass this.
create or replace function public.recently_authenticated(secs integer)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
    where a ->> 'method' in ('password', 'recovery', 'otp')
      and (a ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - secs
  )
$$;

-- ------------------------------------------------------------------ catalogues (read by everyone)

-- playable cars; unlocks and the selected car reference this, so an unknown id can never be stored
create table public.cars (
  id text primary key constraint car_id_format check (id ~ '^[a-z0-9_]{1,32}$'),
  name text not null,
  unlocked_by_default boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.cars (id, name, sort_order) values
  ('r32', 'Skyline GT-R R32', 1),
  ('s13', 'Silvia S13', 2),
  ('s14', 'Silvia S14', 3),
  ('z350', '350Z', 4),
  ('nsx', 'NSX', 5),
  ('tiara83', 'Tiara GT ''83', 6);

create table public.achievements (
  id text primary key constraint achievement_id_format check (id ~ '^[a-z0-9_.]{1,48}$'),
  name_pt text not null,
  name_en text not null,
  description_pt text not null default '',
  description_en text not null default '',
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ player data

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username extensions.citext not null unique
    constraint username_format check (username::text ~ '^[A-Za-z0-9_]{3,20}$'),
  username_changed_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  selected_car text references public.cars (id) on delete set null,
  -- the settings a player carries between devices (audio, controls, language...); validated again by the
  -- game before use. Bounded so the column cannot be used as free storage.
  settings jsonb not null default '{}'::jsonb
    constraint settings_is_object check (jsonb_typeof(settings) = 'object')
    constraint settings_size check (octet_length(settings::text) <= 16384),
  settings_updated_at timestamptz
);

create table public.player_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  distance_m bigint not null default 0 check (distance_m >= 0),
  play_time_s bigint not null default 0 check (play_time_s >= 0),
  drives integer not null default 0 check (drives >= 0),
  rejected_reports integer not null default 0 check (rejected_reports >= 0),
  updated_at timestamptz not null default now()
);

-- one row per drive: the server keeps its own clock, so a report can only claim what could have
-- happened since the previous one
create table public.drive_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  car_id text references public.cars (id) on delete set null,
  started_at timestamptz not null default now(),
  last_report_at timestamptz not null default now(),
  distance_m integer not null default 0 check (distance_m >= 0),
  play_time_s integer not null default 0 check (play_time_s >= 0)
);
create index drive_sessions_user_started on public.drive_sessions (user_id, started_at desc);

create table public.car_unlocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  car_id text not null references public.cars (id) on delete cascade,
  source text not null default 'default' check (source in ('default', 'achievement', 'event', 'admin')),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, car_id)
);

create table public.player_achievements (
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_id text not null references public.achievements (id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

-- personal bests of any kind (lap times, top speed...), written by future server-side checks
create table public.records (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null constraint record_kind_format check (kind ~ '^[a-z0-9_.]{1,48}$'),
  car_id text references public.cars (id) on delete set null,
  value numeric not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 4096),
  created_at timestamptz not null default now()
);
create index records_user_kind on public.records (user_id, kind);
create index records_kind_value on public.records (kind, value);

-- ------------------------------------------------------------------ privileges and row level security

alter table public.cars enable row level security;
alter table public.achievements enable row level security;
alter table public.profiles enable row level security;
alter table public.player_stats enable row level security;
alter table public.drive_sessions enable row level security;
alter table public.car_unlocks enable row level security;
alter table public.player_achievements enable row level security;
alter table public.records enable row level security;

-- start from nothing (Supabase grants broad table privileges to anon/authenticated by default)
revoke all on public.cars, public.achievements, public.profiles, public.player_stats, public.drive_sessions,
  public.car_unlocks, public.player_achievements, public.records from anon, authenticated;

grant select on public.cars, public.achievements to anon, authenticated;
create policy "catalogue is public" on public.cars for select to anon, authenticated using (true);
create policy "catalogue is public" on public.achievements for select to anon, authenticated using (true);

grant select on public.profiles, public.player_stats, public.drive_sessions, public.car_unlocks,
  public.player_achievements, public.records to authenticated;
-- the only columns a player writes directly
grant update (selected_car, settings) on public.profiles to authenticated;

create policy "own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "own stats" on public.player_stats for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "own drives" on public.drive_sessions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "own unlocks" on public.car_unlocks for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "own achievements" on public.player_achievements for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "own records" on public.records for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ------------------------------------------------------------------ triggers

-- a new account gets its profile and stats. The username comes from the sign-up form; if it is invalid
-- or was taken in the meantime, a free variant is used (the player can change it in the profile).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := new.raw_user_meta_data ->> 'username';
  tag text := substr(replace(new.id::text, '-', ''), 1, 6);
begin
  if not public.username_valid(wanted) then
    wanted := 'driver_' || tag;
  end if;
  begin
    insert into public.profiles (id, username) values (new.id, wanted);
  exception when unique_violation then
    insert into public.profiles (id, username) values (new.id, left(wanted, 13) || '_' || tag);
  end;
  insert into public.player_stats (user_id) values (new.id);
  insert into public.car_unlocks (user_id, car_id, source)
    select new.id, c.id, 'default' from public.cars c where c.unlocked_by_default;
  return new;
end
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- settings changes are stamped by the server, and a burst of writes is refused (the game sends at most one
-- every few seconds)
create or replace function public.profiles_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.settings is distinct from old.settings then
    if old.settings_updated_at is not null and old.settings_updated_at > now() - interval '1 second'
       and current_user = 'authenticated' then
      raise exception 'too_frequent' using errcode = 'P0001';
    end if;
    new.settings_updated_at := now();
  end if;
  return new;
end
$$;
revoke all on function public.profiles_before_update() from public, anon, authenticated;

create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();

-- ------------------------------------------------------------------ functions the game calls (RPC)

-- sign-up form: is this name free? (usernames are public names, so this reveals nothing private)
create or replace function public.username_available(p_name text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select public.username_valid(p_name)
     and not exists (select 1 from public.profiles p where p.username = p_name::extensions.citext)
$$;
revoke all on function public.username_available(text) from public, anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;

-- change the username (once a day)
create or replace function public.set_username(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  last_change timestamptz;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.username_valid(p_name) then raise exception 'invalid_username' using errcode = '22023'; end if;
  select username_changed_at into last_change from public.profiles where id = uid for update;
  if not found then raise exception 'no_profile' using errcode = 'P0002'; end if;
  if last_change is not null and last_change > now() - interval '1 day' then
    raise exception 'username_cooldown' using errcode = 'P0001';
  end if;
  begin
    update public.profiles set username = p_name, username_changed_at = now() where id = uid;
  exception when unique_violation then
    raise exception 'username_taken' using errcode = '23505';
  end;
  return p_name;
end
$$;
revoke all on function public.set_username(text) from public, anon, authenticated;
grant execute on function public.set_username(text) to authenticated;

-- "I'm here": last access, at most once a minute
create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set last_seen_at = now()
  where id = auth.uid() and last_seen_at < now() - interval '1 minute'
$$;
revoke all on function public.touch_last_seen() from public, anon, authenticated;
grant execute on function public.touch_last_seen() to authenticated;

-- a drive begins: returns its id. The car must exist and be unlocked for this player.
create or replace function public.start_drive(p_car text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.car_unlocks u where u.user_id = uid and u.car_id = p_car) then
    raise exception 'car_locked' using errcode = '42501';
  end if;
  if exists (select 1 from public.drive_sessions d where d.user_id = uid and d.started_at > now() - interval '5 seconds') then
    raise exception 'too_frequent' using errcode = 'P0001';
  end if;
  insert into public.drive_sessions (user_id, car_id) values (uid, p_car) returning id into sid;
  update public.player_stats set drives = drives + 1, updated_at = now() where user_id = uid;
  update public.profiles set selected_car = p_car, last_seen_at = now() where id = uid;
  return sid;
end
$$;
revoke all on function public.start_drive(text) from public, anon, authenticated;
grant execute on function public.start_drive(text) to authenticated;

-- what happened since the last report of this drive. The browser only reports; the server decides what
-- counts: no more time than has really passed, no more distance than the fastest car could cover in it.
-- A report that fails the check is not counted (and is tallied in rejected_reports).
create or replace function public.report_drive(p_session uuid, p_distance_m numeric, p_seconds numeric)
returns table (total_distance_m bigint, total_play_time_s bigint, accepted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.drive_sessions%rowtype;
  elapsed numeric;
  ok boolean;
  max_speed constant numeric := 125;   -- m/s (450 km/h): above any car in the game
  max_gap constant numeric := 900;     -- a report covers at most 15 minutes
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_distance_m is null or p_seconds is null or p_distance_m < 0 or p_seconds < 0
     or p_distance_m > 1e6 or p_seconds > 1e5 then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  select * into s from public.drive_sessions d where d.id = p_session and d.user_id = uid for update;
  if not found then raise exception 'unknown_drive' using errcode = 'P0002'; end if;
  elapsed := extract(epoch from now() - s.last_report_at);
  if elapsed < 5 then raise exception 'too_frequent' using errcode = 'P0001'; end if;
  ok := elapsed <= max_gap + 60
    and p_seconds <= elapsed + 2
    and p_distance_m <= max_speed * least(p_seconds, elapsed) + 50;
  if ok then
    update public.drive_sessions
      set last_report_at = now(), distance_m = drive_sessions.distance_m + round(p_distance_m)::integer,
          play_time_s = drive_sessions.play_time_s + round(p_seconds)::integer
      where id = s.id;
    update public.player_stats
      set distance_m = player_stats.distance_m + round(p_distance_m)::bigint,
          play_time_s = player_stats.play_time_s + round(p_seconds)::bigint, updated_at = now()
      where user_id = uid;
  else
    update public.drive_sessions set last_report_at = now() where id = s.id;
    update public.player_stats set rejected_reports = rejected_reports + 1, updated_at = now() where user_id = uid;
  end if;
  return query select p.distance_m, p.play_time_s, ok from public.player_stats p where p.user_id = uid;
end
$$;
revoke all on function public.report_drive(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.report_drive(uuid, numeric, numeric) to authenticated;

-- delete my account and everything in it. Requires having typed the password (or used a recovery link)
-- in the last 10 minutes, so a stolen session alone cannot erase an account.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.recently_authenticated(600) then
    raise exception 'reauthentication_needed' using errcode = '42501';
  end if;
  delete from auth.users where id = uid;
end
$$;
revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- helpers are internal (policies call them as the invoking role; is_admin only reads the caller's token)
revoke all on function public.username_reserved(text) from public, anon, authenticated;
revoke all on function public.username_valid(text) from public, anon, authenticated;
revoke all on function public.recently_authenticated(integer) from public, anon, authenticated;
grant execute on function public.username_reserved(text), public.username_valid(text) to anon, authenticated;
grant execute on function public.recently_authenticated(integer) to authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
