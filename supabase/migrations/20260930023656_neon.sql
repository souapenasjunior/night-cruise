-- Neon underglow: LED light under the car, bought with yen. Each colour is bought once and can then be
-- fitted to any car the player drives (which colour goes on which car is a setting of the game). Online
-- rooms show another player's neon only if the account owns that colour (the room checks neon_unlocks).

create table public.neons (
  id text primary key constraint neon_id_format check (id ~ '^[a-z0-9_]{1,32}$'),
  name text not null,
  hex text not null check (hex ~ '^#[0-9a-f]{6}$'),
  price_coins integer not null check (price_coins > 0),
  sort_order integer not null default 0
);
insert into public.neons (id, name, hex, price_coins, sort_order) values
  ('blue', 'Azul elétrico', '#1f7bff', 4000, 1),
  ('cyan', 'Ciano', '#19f0ff', 4000, 2),
  ('pink', 'Rosa neon', '#ff2bd6', 4000, 3),
  ('green', 'Verde neon', '#2bff6a', 4000, 4),
  ('purple', 'Roxo', '#9a4dff', 4000, 5);

create table public.neon_unlocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  neon_id text not null references public.neons (id) on delete cascade,
  bought_at timestamptz not null default now(),
  primary key (user_id, neon_id)
);

alter table public.neons enable row level security;
alter table public.neon_unlocks enable row level security;
revoke all on public.neons, public.neon_unlocks from anon, authenticated;
grant select on public.neons to anon, authenticated;
create policy "neon catalogue is public" on public.neons for select to anon, authenticated using (true);
grant select on public.neon_unlocks to authenticated;
create policy "own neons" on public.neon_unlocks for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- buy one neon colour with yen: it must exist, not be owned yet, and be affordable. Returns the new balance.
create or replace function public.buy_neon(p_neon text)
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
  select n.price_coins into price from public.neons n where n.id = p_neon;
  if not found then raise exception 'not_for_sale' using errcode = 'P0002'; end if;
  if exists (select 1 from public.neon_unlocks u where u.user_id = uid and u.neon_id = p_neon) then
    raise exception 'already_owned' using errcode = 'P0001';
  end if;
  select p.coins into bal from public.player_stats p where p.user_id = uid for update;
  if not found then raise exception 'no_profile' using errcode = 'P0002'; end if;
  if bal < price then raise exception 'not_enough_coins' using errcode = 'P0001'; end if;
  update public.player_stats set coins = coins - price, updated_at = now() where user_id = uid returning coins into bal;
  insert into public.neon_unlocks (user_id, neon_id) values (uid, p_neon);
  return bal;
end
$$;
revoke all on function public.buy_neon(text) from public, anon, authenticated;
grant execute on function public.buy_neon(text) to authenticated;
