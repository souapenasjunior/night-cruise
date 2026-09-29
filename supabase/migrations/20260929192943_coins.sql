-- In-game currency (yen, ¥) replaces the real-money shop. There are no external purchases at all:
-- players earn yen by driving and spend it on cars, one at a time.
--
-- Earning (server-side only, inside report_drive, from the distance the server already accepted as
-- plausible): ¥1 per 10 m driven, times a cruise bonus for keeping the same drive going
-- (x1.25 after 10 min, x1.5 after 30 min, x2 after 60 min). The balance has no write grant: it changes
-- only in report_drive (earning) and buy_car (spending).

-- ------------------------------------------------------------------ the real-money shop goes away
drop function if exists public.shop_apply_payment(uuid, text, text, text, integer, text);
drop function if exists public.shop_set_preference(uuid, text);
drop function if exists public.shop_create_order(uuid, text);
drop table if exists public.orders;
drop table if exists public.product_cars;
drop table if exists public.products;

-- ------------------------------------------------------------------ balance and prices
alter table public.player_stats
  add column coins bigint not null default 0 check (coins >= 0),
  add column coins_earned bigint not null default 0 check (coins_earned >= 0),
  add column coin_carry_m integer not null default 0 check (coin_carry_m >= 0 and coin_carry_m < 10);

-- price in yen; null = not for sale (the free cars)
alter table public.cars add column price_coins integer check (price_coins is null or price_coins > 0);
update public.cars set price_coins = p.price from (values
  ('p_eclipse', 25000), ('p_s2000', 30000), ('p_s15', 35000), ('p_rx7', 40000),
  ('p_supra2', 45000), ('p_supra', 55000), ('p_r34', 60000)
) as p(id, price) where cars.id = p.id;

-- ------------------------------------------------------------------ earning: report_drive
-- (same checks as before; accepted distance now also pays yen. The return type changes: drop first.)
drop function if exists public.report_drive(uuid, numeric, numeric);
create function public.report_drive(p_session uuid, p_distance_m numeric, p_seconds numeric)
returns table (total_distance_m bigint, total_play_time_s bigint, accepted boolean, coins bigint, earned integer, bonus numeric)
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
  mult numeric := 1;
  carry integer;
  metres bigint;
  got integer := 0;
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
    -- cruise bonus: how long this drive has been going (server clock)
    mult := case
      when s.play_time_s >= 3600 then 2
      when s.play_time_s >= 1800 then 1.5
      when s.play_time_s >= 600 then 1.25
      else 1 end;
    select p.coin_carry_m into carry from public.player_stats p where p.user_id = uid for update;
    metres := round(p_distance_m)::bigint + coalesce(carry, 0);
    got := floor((metres / 10) * mult)::integer;
    update public.drive_sessions
      set last_report_at = now(), distance_m = drive_sessions.distance_m + round(p_distance_m)::integer,
          play_time_s = drive_sessions.play_time_s + round(p_seconds)::integer
      where id = s.id;
    update public.player_stats
      set distance_m = player_stats.distance_m + round(p_distance_m)::bigint,
          play_time_s = player_stats.play_time_s + round(p_seconds)::bigint,
          coins = player_stats.coins + got, coins_earned = player_stats.coins_earned + got,
          coin_carry_m = (metres % 10)::integer, updated_at = now()
      where user_id = uid;
  else
    update public.drive_sessions set last_report_at = now() where id = s.id;
    update public.player_stats set rejected_reports = rejected_reports + 1, updated_at = now() where user_id = uid;
  end if;
  return query select p.distance_m, p.play_time_s, ok, p.coins, got, mult from public.player_stats p where p.user_id = uid;
end
$$;
revoke all on function public.report_drive(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.report_drive(uuid, numeric, numeric) to authenticated;

-- ------------------------------------------------------------------ spending: buy_car
-- buy one car with yen: it must be for sale, not owned yet, and affordable. Returns the new balance.
create or replace function public.buy_car(p_car text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  price integer;
  bal bigint;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select c.price_coins into price from public.cars c where c.id = p_car;
  if not found or price is null then raise exception 'not_for_sale' using errcode = 'P0002'; end if;
  if exists (select 1 from public.car_unlocks u where u.user_id = uid and u.car_id = p_car) then
    raise exception 'already_owned' using errcode = 'P0001';
  end if;
  select p.coins into bal from public.player_stats p where p.user_id = uid for update;
  if not found then raise exception 'no_profile' using errcode = 'P0002'; end if;
  if bal < price then raise exception 'not_enough_coins' using errcode = 'P0001'; end if;
  update public.player_stats set coins = coins - price, updated_at = now() where user_id = uid returning coins into bal;
  insert into public.car_unlocks (user_id, car_id, source) values (uid, p_car, 'purchase');
  return bal;
end
$$;
revoke all on function public.buy_car(text) from public, anon, authenticated;
grant execute on function public.buy_car(text) to authenticated;
