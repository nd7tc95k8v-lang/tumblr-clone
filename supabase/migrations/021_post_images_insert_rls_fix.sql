-- Fix post_images INSERT failing when the author cannot SELECT their own row under posts RLS
-- (e.g. NSFW posts + posts_select_respect_nsfw_* in 017).
-- Replaces inline EXISTS policy with SECURITY DEFINER ownership check + path prefix (matches PostForm: userId/uuid.ext).

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
      and p.reblog_of is null
  )
  and coalesce(nullif(trim(p_storage_path), ''), '') <> ''
  and split_part(trim(p_storage_path), '/', 1) = auth.uid()::text;
$$;

revoke all on function public.post_image_row_insert_allowed(uuid, text) from public;
grant execute on function public.post_image_row_insert_allowed(uuid, text) to authenticated;

drop policy if exists "post_images_insert_own_post" on public.post_images;

create policy "post_images_insert_own_post"
  on public.post_images for insert
  to authenticated
  with check (
    public.post_image_row_insert_allowed(post_id, storage_path)
  );
