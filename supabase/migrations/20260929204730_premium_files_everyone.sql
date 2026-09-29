-- The car select shows every car as a turning 3D model, locked ones too, also to visitors without an
-- account: anyone may read the premium car files. Driving one still needs owning it (start_drive,
-- car_unlocks); the bucket stays private (files through signed URLs, no public listing of the bucket).
drop policy if exists "premium cars: signed-in players read" on storage.objects;
drop policy if exists "premium cars: everyone reads" on storage.objects;
create policy "premium cars: everyone reads" on storage.objects for select to anon, authenticated
  using (bucket_id = 'premium');
