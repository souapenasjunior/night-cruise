-- Premium car files (the 3D model and its textures) live in a private Storage bucket, one folder per car
-- (premium/p_r34/...). A player can read a car's folder only when that car is unlocked on their account
-- (car_unlocks, written only by the server), so the paid models are not downloadable by everyone.
-- The game asks for short-lived signed URLs of its own cars' files.

insert into storage.buckets (id, name, public, file_size_limit)
values ('premium', 'premium', false, 8388608)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "premium cars: owners read" on storage.objects;
create policy "premium cars: owners read" on storage.objects for select to authenticated
  using (
    bucket_id = 'premium'
    and exists (
      select 1 from public.car_unlocks u
      where u.user_id = (select auth.uid()) and u.car_id = (storage.foldername(name))[1]
    )
  );
