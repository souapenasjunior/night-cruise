-- Friends: a player adds another by username; the other accepts (or declines). Friends see each other
-- online: whether they are in the game, driving, and in which online room (so they can join them,
-- private rooms included). Everything goes through the functions below; nobody writes the tables.

-- one row per pair (a < b): pending until the other one accepts
create table public.friendships (
  a uuid not null references auth.users (id) on delete cascade,
  b uuid not null references auth.users (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (a, b),
  constraint pair_order check (a < b),
  constraint requester_in_pair check (requested_by in (a, b))
);
create index friendships_b on public.friendships (b);

-- where a player is right now: refreshed by the game about every 45 s while it is open
create table public.presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now(),
  activity text not null default 'menu' check (activity in ('menu', 'drive')),
  room text check (room ~ '^(k1-[0-9]{2}|p-[A-Z0-9]{6})$'),
  car text references public.cars (id) on delete set null
);

alter table public.friendships enable row level security;
alter table public.presence enable row level security;
revoke all on public.friendships, public.presence from anon, authenticated;
grant select on public.friendships to authenticated;
create policy "own friendships" on public.friendships for select to authenticated
  using ((select auth.uid()) in (a, b));
-- presence is read only through my_friends() (friends only)

-- "I'm here": what the game is doing now (the room only while playing online)
create or replace function public.heartbeat(p_activity text, p_room text, p_car text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_activity is null or p_activity not in ('menu', 'drive') then p_activity := 'menu'; end if;
  if p_room is not null and p_room !~ '^(k1-[0-9]{2}|p-[A-Z0-9]{6})$' then p_room := null; end if;
  if p_car is not null and not exists (select 1 from public.cars c where c.id = p_car) then p_car := null; end if;
  insert into public.presence (user_id, seen_at, activity, room, car)
  values (uid, now(), p_activity, p_room, p_car)
  on conflict (user_id) do update set seen_at = now(), activity = excluded.activity, room = excluded.room, car = excluded.car;
  update public.profiles set last_seen_at = now() where id = uid and last_seen_at < now() - interval '1 minute';
end
$$;

-- leaving the game (tab closed, signed out): shown offline straight away
create or replace function public.go_offline()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.presence where user_id = auth.uid()
$$;

-- ask someone to be friends, by username. If they had already asked me, we become friends.
-- Returns 'sent', 'accepted', 'already_friends' or 'already_sent'.
create or replace function public.friend_request(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  other uuid;
  lo uuid; hi uuid;
  f public.friendships;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,20}$' then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  -- (citext's own "=", case-insensitive: with an empty search_path a bare "=" would compare as text)
  select p.id into other from public.profiles p where p.username operator(extensions.=) p_username::extensions.citext;
  if other is null then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  if other = uid then raise exception 'cannot_add_self' using errcode = '22023'; end if;
  lo := least(uid, other); hi := greatest(uid, other);
  select * into f from public.friendships where a = lo and b = hi for update;
  if found then
    if f.status = 'accepted' then return 'already_friends'; end if;
    if f.requested_by = uid then return 'already_sent'; end if;
    update public.friendships set status = 'accepted', accepted_at = now() where a = lo and b = hi;
    return 'accepted';
  end if;
  -- limits: a friend list is not a spam channel
  if (select count(*) from public.friendships where requested_by = uid and status = 'pending') >= 30 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  if (select count(*) from public.friendships where uid in (a, b) and status = 'accepted') >= 200 then
    raise exception 'too_many_friends' using errcode = 'P0001';
  end if;
  insert into public.friendships (a, b, requested_by) values (lo, hi, uid);
  return 'sent';
end
$$;

-- answer a request someone sent me: accept, or decline (the request is removed)
create or replace function public.friend_respond(p_other uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_accept then
    update public.friendships set status = 'accepted', accepted_at = now()
    where a = least(uid, p_other) and b = greatest(uid, p_other) and status = 'pending' and requested_by = p_other;
  else
    delete from public.friendships
    where a = least(uid, p_other) and b = greatest(uid, p_other) and status = 'pending' and requested_by = p_other;
  end if;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
end
$$;

-- unfriend, or cancel a request I sent
create or replace function public.friend_remove(p_other uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.friendships where a = least(auth.uid(), p_other) and b = greatest(auth.uid(), p_other)
$$;

-- my friends and requests, with what each friend is doing (online: seen in the last 2 minutes)
create or replace function public.my_friends()
returns table (id uuid, username text, status text, online boolean, activity text, room text, car text, last_seen timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, p.username::text,
    case when f.status = 'accepted' then 'friend' when f.requested_by = auth.uid() then 'outgoing' else 'incoming' end,
    f.status = 'accepted' and coalesce(pr.seen_at > now() - interval '2 minutes', false),
    case when f.status = 'accepted' and pr.seen_at > now() - interval '2 minutes' then pr.activity end,
    case when f.status = 'accepted' and pr.seen_at > now() - interval '2 minutes' then pr.room end,
    case when f.status = 'accepted' and pr.seen_at > now() - interval '2 minutes' then pr.car end,
    case when f.status = 'accepted' then greatest(p.last_seen_at, pr.seen_at) end
  from public.friendships f
  cross join lateral (select case when f.a = auth.uid() then f.b else f.a end as id) o
  join public.profiles p on p.id = o.id
  left join public.presence pr on pr.user_id = o.id
  where auth.uid() in (f.a, f.b)
$$;

-- (fix) the sign-up check compared names case-sensitively (a bare "=" with an empty search_path):
-- "kaiju_driver" showed as free while "Kaiju_Driver" existed
create or replace function public.username_available(p_name text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select public.username_valid(p_name)
     and not exists (select 1 from public.profiles p where p.username operator(extensions.=) p_name::extensions.citext)
$$;

revoke all on function public.heartbeat(text, text, text), public.go_offline(), public.friend_request(text),
  public.friend_respond(uuid, boolean), public.friend_remove(uuid), public.my_friends() from public, anon, authenticated;
grant execute on function public.heartbeat(text, text, text), public.go_offline(), public.friend_request(text),
  public.friend_respond(uuid, boolean), public.friend_remove(uuid), public.my_friends() to authenticated;
