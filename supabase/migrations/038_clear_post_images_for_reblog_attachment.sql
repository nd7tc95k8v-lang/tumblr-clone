-- Reblog editor attachments: remove trigger-copied root gallery rows before inserting uploader-owned paths.
--
-- Root cause: `post_images_copy_for_reblog` (020) runs AFTER INSERT and copies `post_images` from the chain root.
-- The client then deletes those rows with `delete from post_images where post_id = …`.
-- `post_images_delete_own_post` (020) uses `exists (select 1 from posts p where p.id = post_images.post_id and p.user_id = auth.uid())`.
-- `posts_select_respect_nsfw_authenticated` (017) does NOT exempt the author, so for NSFW posts the subquery
-- returns no rows under RLS → DELETE matches 0 rows → inherited paths remain and uploader inserts fail or never replace.
--
-- This SECURITY DEFINER helper checks authorship without relying on posts SELECT RLS, then deletes all junction rows.

create or replace function public.clear_post_images_for_reblog_attachment(p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  if p_post_id is null then
    raise exception 'p_post_id required';
  end if;

  if not exists (
    select 1
    from public.posts p
    where p.id = p_post_id
      and p.user_id = auth.uid()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.post_images
  where post_id = p_post_id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.clear_post_images_for_reblog_attachment(uuid) is
  'Author-only: delete all post_images for a reblog row so editor attachments can replace post_images_copy_for_reblog copies. Bypasses posts RLS used by naive client DELETE.';

revoke all on function public.clear_post_images_for_reblog_attachment(uuid) from public;
grant execute on function public.clear_post_images_for_reblog_attachment(uuid) to authenticated;
