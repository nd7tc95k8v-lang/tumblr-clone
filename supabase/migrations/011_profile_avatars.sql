-- Public profile picture URL (Supabase Storage public URL).
alter table public.profiles
  add column if not exists avatar_url text;

-- Bucket: objects under {user_id}/... (same pattern as post-images).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

create policy "avatars select public"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars insert own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "avatars update own folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

create policy "avatars delete own folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
