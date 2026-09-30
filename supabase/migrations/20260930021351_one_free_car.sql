-- Only the Tiara GT '83 is free now: every other car is bought with yen, the R32 and the NSX included
-- (the cheapest steps of the ladder). Slap Jack's Supra leaves the game: whoever bought it gets the yen
-- back first.

-- ------------------------------------------------------------------ Slap Jack's Supra goes away
update public.player_stats s set coins = s.coins + c.price_coins, updated_at = now()
from public.car_unlocks u join public.cars c on c.id = u.car_id
where u.car_id = 'p_supra2' and u.source = 'purchase' and s.user_id = u.user_id and c.price_coins is not null;
-- (car_unlocks cascade; the last car picked, drives and presence keep a null car)
delete from public.cars where id = 'p_supra2';

-- ------------------------------------------------------------------ one free car
update public.cars set unlocked_by_default = false, price_coins = p.price from (values
  ('r32', 8000), ('nsx', 12000)
) as p(id, price) where cars.id = p.id;
-- the free unlocks they came with go too (bought cars stay bought)
delete from public.car_unlocks where car_id in ('r32', 'nsx') and source = 'default';
