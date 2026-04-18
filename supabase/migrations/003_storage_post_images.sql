-- Public bucket for post images; objects live under {user_id}/...
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do update set public = excluded.public;

-- Anyone can load images via public URL (bucket is public).
drop policy if exists "post-images select public" on storage.objects;

create policy "post-images select public"
  on storage.objects for select
  using (bucket_id = 'post-images');

-- Authenticated users may upload only into a folder named with their user id.
drop policy if exists "post-images insert own folder" on storage.objects;

create policy "post-images insert own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
