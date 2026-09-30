-- The neon underglow leaves the game. Whoever bought colours gets the yen back first.
update public.player_stats s set coins = s.coins + r.total, updated_at = now()
from (
  select u.user_id, sum(n.price_coins)::bigint as total
  from public.neon_unlocks u join public.neons n on n.id = u.neon_id
  group by u.user_id
) r
where s.user_id = r.user_id;

drop function if exists public.buy_neon(text);
drop table if exists public.neon_unlocks;
drop table if exists public.neons;
