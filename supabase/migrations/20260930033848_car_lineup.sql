-- Twelve more cars, and one price ladder for all 21: the weakest is free (Tiara GT '83), every other car
-- costs more the better it is (top speed, acceleration, grip: real figures, the film cars as tuned in the
-- films). The currency is now called NCP (Night Cruise Points) in the game; the columns keep their names.
-- Cars already bought stay bought.
insert into public.cars (id, name, unlocked_by_default, sort_order) values
  ('p_mustang', 'Shelby GT350 1965', false, 2),
  ('p_evo7', 'Brian''s Evo VII', false, 9),
  ('p_718', '718 Spyder', false, 12),
  ('p_challenger', 'Challenger SRT Super Stock', false, 13),
  ('p_vette13', 'Corvette Z06 2013', false, 14),
  ('p_targa', '911 Targa 4 GTS', false, 15),
  ('p_gtr35', 'GT-R Black Edition', false, 16),
  ('p_458', '458 Italia', false, 17),
  ('p_r8', 'R8 Green Hell', false, 18),
  ('p_huracan', 'Huracán Performante', false, 19),
  ('p_vette23', 'Corvette Z06 2023', false, 20),
  ('p_911', '911 Turbo S', false, 21)
on conflict (id) do nothing;

update public.cars c set price_coins = p.price, sort_order = p.ord from (values
  ('tiara83', null::integer, 1),
  ('p_mustang', 6000, 2),
  ('p_eclipse', 9000, 3),
  ('p_s2000', 12000, 4),
  ('p_s15', 15000, 5),
  ('r32', 18000, 6),
  ('nsx', 21000, 7),
  ('p_rx7', 24000, 8),
  ('p_evo7', 27000, 9),
  ('p_supra', 32000, 10),
  ('p_r34', 36000, 11),
  ('p_718', 42000, 12),
  ('p_challenger', 48000, 13),
  ('p_vette13', 54000, 14),
  ('p_targa', 62000, 15),
  ('p_gtr35', 70000, 16),
  ('p_458', 80000, 17),
  ('p_r8', 90000, 18),
  ('p_huracan', 100000, 19),
  ('p_vette23', 110000, 20),
  ('p_911', 120000, 21)
) as p(id, price, ord) where c.id = p.id;
