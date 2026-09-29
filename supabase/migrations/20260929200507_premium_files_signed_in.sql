-- Online mode: players see each other's cars, so any signed-in player may read the premium car files
-- (to draw someone else's premium car). Driving one still needs owning it (start_drive, car_unlocks);
-- visitors without an account still cannot read the files.
drop policy if exists "premium cars: owners read" on storage.objects;
drop policy if exists "premium cars: signed-in players read" on storage.objects;
create policy "premium cars: signed-in players read" on storage.objects for select to authenticated
  using (bucket_id = 'premium');
