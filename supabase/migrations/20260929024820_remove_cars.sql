-- The Silvia S13, Silvia S14 and 350Z leave the game. Their unlocks go with them (on delete cascade);
-- a profile or drive that referenced one keeps its row with the car cleared (on delete set null).
delete from public.cars where id in ('s13', 's14', 'z350');
update public.cars set sort_order = 1 where id = 'r32';
update public.cars set sort_order = 2 where id = 'nsx';
update public.cars set sort_order = 3 where id = 'tiara83';
