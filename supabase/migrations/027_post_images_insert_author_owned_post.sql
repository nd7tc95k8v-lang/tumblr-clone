-- Allow post_images inserts on any post authored by the current user (originals + reblogs),
-- as long as the object path is under `{auth.uid()}/...`. Replaces the originals-only check
-- from 021 so quote-layer rows can attach uploader-owned media from the client.

create or replace function public.post_image_row_insert_allowed(p_post_id uuid, p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.posts p
    where p.id = p_post_id
      and p.user_id = auth.uid()
  )
  and coalesce(nullif(trim(p_storage_path), ''), '') <> ''
  and split_part(trim(p_storage_path), '/', 1) = auth.uid()::text;
$$;
