-- Shop: the Premium Pack (7 cars, R$ 19,90) sold through Mercado Pago Checkout Pro.
--
-- How a purchase flows
--   1. The game calls the Edge Function create-checkout with the player's JWT. The function (service role)
--      calls shop_create_order, which checks the product and the player and opens an order with the price
--      taken from this database, never from the browser. It then creates the Mercado Pago preference with
--      the order id as external_reference.
--   2. Mercado Pago notifies the Edge Function mp-webhook. The function checks the notification signature,
--      then fetches the payment from the Mercado Pago API itself (the notification body is not trusted) and
--      passes what the API said to shop_apply_payment.
--   3. shop_apply_payment unlocks the cars only for an approved payment of the exact price and currency of
--      the order; a refund or chargeback takes them back. Applying the same payment twice changes nothing.
-- Players can read their own orders and nothing else here is writable by them: the shop functions are
-- granted to service_role only.

-- ------------------------------------------------------------------ catalogue

insert into public.cars (id, name, unlocked_by_default, sort_order) values
  ('p_r34', 'Brian''s Skyline R34', false, 10),
  ('p_rx7', 'Julius''s RX-7', false, 11),
  ('p_eclipse', 'Eclipse 1995', false, 12),
  ('p_s15', 'Silvia S15 "Mona Lisa"', false, 13),
  ('p_supra2', 'Slap Jack''s Supra', false, 14),
  ('p_s2000', 'Suki''s S2000', false, 15),
  ('p_supra', 'Supra MK IV', false, 16);

alter table public.car_unlocks drop constraint if exists car_unlocks_source_check;
alter table public.car_unlocks add constraint car_unlocks_source_check
  check (source in ('default', 'achievement', 'event', 'admin', 'purchase'));

create table public.products (
  id text primary key constraint product_id_format check (id ~ '^[a-z0-9_]{1,32}$'),
  name text not null,
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.product_cars (
  product_id text not null references public.products (id) on delete cascade,
  car_id text not null references public.cars (id) on delete cascade,
  primary key (product_id, car_id)
);

insert into public.products (id, name, price_cents, currency) values ('premium_pack', 'Night Cruise - Pacote Premium (7 carros)', 1990, 'BRL');
insert into public.product_cars (product_id, car_id)
  select 'premium_pack', id from public.cars where id like 'p\_%';

-- ------------------------------------------------------------------ orders

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id text not null references public.products (id),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  status text not null default 'created'
    check (status in ('created', 'pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back')),
  mp_preference_id text,
  mp_payment_id text unique,
  mp_status_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);
create index orders_user_created on public.orders (user_id, created_at desc);

alter table public.products enable row level security;
alter table public.product_cars enable row level security;
alter table public.orders enable row level security;
revoke all on public.products, public.product_cars, public.orders from anon, authenticated;

grant select on public.products, public.product_cars to anon, authenticated;
create policy "catalogue is public" on public.products for select to anon, authenticated using (true);
create policy "catalogue is public" on public.product_cars for select to anon, authenticated using (true);

grant select on public.orders to authenticated;
create policy "own orders" on public.orders for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ------------------------------------------------------------------ server-only functions (service_role)

-- open an order for this player. Refuses an unknown or inactive product, a player who already owns every
-- car in it, and more than 10 orders an hour.
create or replace function public.shop_create_order(p_user uuid, p_product text)
returns table (order_id uuid, amount_cents integer, currency text, title text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.products%rowtype;
  oid uuid;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'unknown_user' using errcode = 'P0002';
  end if;
  select * into pr from public.products p where p.id = p_product and p.active;
  if not found then raise exception 'unknown_product' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.product_cars pc
    where pc.product_id = pr.id
      and not exists (select 1 from public.car_unlocks u where u.user_id = p_user and u.car_id = pc.car_id)
  ) then
    raise exception 'already_owned' using errcode = 'P0001';
  end if;
  if (select count(*) from public.orders o where o.user_id = p_user and o.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_frequent' using errcode = 'P0001';
  end if;
  insert into public.orders (user_id, product_id, amount_cents, currency)
    values (p_user, pr.id, pr.price_cents, pr.currency) returning id into oid;
  return query select oid, pr.price_cents, pr.currency, pr.name;
end
$$;

create or replace function public.shop_set_preference(p_order uuid, p_preference text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.orders set mp_preference_id = p_preference, updated_at = now() where id = p_order
$$;

-- what the Mercado Pago API says about a payment of this order. Returns the order's resulting status.
create or replace function public.shop_apply_payment(
  p_order uuid, p_payment_id text, p_status text, p_status_detail text, p_amount_cents integer, p_currency text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  st text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'unknown_order' using errcode = 'P0002'; end if;
  if o.mp_payment_id is not null and p_payment_id is distinct from o.mp_payment_id and o.status in ('approved', 'refunded', 'charged_back') then
    -- a second payment for an order already settled: leave the order alone (refund it in Mercado Pago)
    return o.status;
  end if;
  st := case p_status
    when 'approved' then 'approved'
    when 'authorized' then 'pending'
    when 'pending' then 'pending'
    when 'in_process' then 'pending'
    when 'in_mediation' then 'pending'
    when 'rejected' then 'rejected'
    when 'cancelled' then 'cancelled'
    when 'refunded' then 'refunded'
    when 'charged_back' then 'charged_back'
    else null end;
  if st is null then raise exception 'unknown_status' using errcode = '22023'; end if;
  if st = 'approved' and (p_amount_cents is distinct from o.amount_cents or p_currency is distinct from o.currency) then
    raise exception 'amount_mismatch' using errcode = '22023';
  end if;
  -- once approved, only a refund or chargeback changes the order (late "pending" notifications do not)
  if o.status = 'approved' and st not in ('approved', 'refunded', 'charged_back') then return o.status; end if;
  if o.status in ('refunded', 'charged_back') then return o.status; end if;

  update public.orders set status = st, mp_payment_id = coalesce(p_payment_id, mp_payment_id),
    mp_status_detail = p_status_detail, updated_at = now(),
    paid_at = case when st = 'approved' then coalesce(paid_at, now()) else paid_at end
    where id = o.id;

  if st = 'approved' then
    insert into public.car_unlocks (user_id, car_id, source)
      select o.user_id, pc.car_id, 'purchase' from public.product_cars pc where pc.product_id = o.product_id
      on conflict (user_id, car_id) do nothing;
  elsif st in ('refunded', 'charged_back') and o.status = 'approved' then
    -- take the cars back unless another approved order still pays for them
    if not exists (select 1 from public.orders x where x.user_id = o.user_id and x.product_id = o.product_id and x.id <> o.id and x.status = 'approved') then
      delete from public.car_unlocks u
        using public.product_cars pc
        where pc.product_id = o.product_id and u.car_id = pc.car_id and u.user_id = o.user_id and u.source = 'purchase';
    end if;
  end if;
  return st;
end
$$;

revoke all on function public.shop_create_order(uuid, text) from public, anon, authenticated;
revoke all on function public.shop_set_preference(uuid, text) from public, anon, authenticated;
revoke all on function public.shop_apply_payment(uuid, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.shop_create_order(uuid, text) to service_role;
grant execute on function public.shop_set_preference(uuid, text) to service_role;
grant execute on function public.shop_apply_payment(uuid, text, text, text, integer, text) to service_role;
