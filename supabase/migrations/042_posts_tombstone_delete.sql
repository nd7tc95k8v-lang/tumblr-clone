-- Tombstone thread roots with reblogs instead of deleting them (supersedes 040 delete_own_post).
-- Keeps id + original_post_id stable; does not repoint likes, notes, or other users' reblogs.

alter table public.posts
  add column if not exists deleted_at timestamptz;

comment on column public.posts.deleted_at is
  'When set, the author removed this thread root; content and owner media are cleared. Row remains for FKs and reblog chains.';

create index if not exists posts_deleted_at_idx
  on public.posts (deleted_at)
  where deleted_at is not null;

-- 040 defined delete_own_post as void; Postgres cannot change return type via CREATE OR REPLACE.
drop function if exists public.delete_own_post(uuid);

create or replace function public.delete_own_post(p_post_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_post public.posts%rowtype;
  v_is_thread_root boolean;
  v_reblog_count bigint;
  v_prefix text;
  v_paths text[];
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_post_id is null then
    raise exception 'p_post_id required';
  end if;

  select * into v_post from public.posts where id = p_post_id;
  if not found then
    return array[]::text[];
  end if;

  if v_post.user_id is distinct from v_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_prefix := v_user_id::text || '/';

  select coalesce(
    array_agg(distinct path) filter (where path is not null),
    array[]::text[]
  )
  into v_paths
  from (
    select nullif(btrim(pi.storage_path), '') as path
    from public.post_images pi
    where pi.post_id = p_post_id
      and pi.storage_path like v_prefix || '%'
    union all
    select nullif(btrim(v_post.image_storage_path), '')
    where nullif(btrim(v_post.image_storage_path), '') like v_prefix || '%'
  ) s;

  v_is_thread_root := (v_post.original_post_id = v_post.id);

  if v_is_thread_root then
    select count(*) into v_reblog_count
    from public.posts p
    where p.original_post_id = v_post.id
      and p.id <> v_post.id;

    if v_reblog_count > 0 then
      if v_post.deleted_at is not null then
        return coalesce(v_paths, array[]::text[]);
      end if;

      delete from public.post_images
      where post_id = p_post_id
        and storage_path like v_prefix || '%';

      update public.posts
      set
        deleted_at = now(),
        content = '',
        tags = '{}',
        image_url = null,
        image_storage_path = null,
        reblog_commentary = null
      where id = p_post_id
        and user_id = v_user_id;

      return coalesce(v_paths, array[]::text[]);
    end if;

    if v_post.deleted_at is not null then
      delete from public.posts
      where id = p_post_id
        and user_id = v_user_id;
      return coalesce(v_paths, array[]::text[]);
    end if;
  end if;

  delete from public.posts
  where id = p_post_id
    and user_id = v_user_id;

  return coalesce(v_paths, array[]::text[]);
end;
$$;

comment on function public.delete_own_post(uuid) is
  'Author-only delete. Returns owner-prefixed storage paths cleared from the row for client bucket cleanup. Reblogs: hard delete. Thread root with reblogs: tombstone (keep id). Thread root without reblogs: hard delete.';

revoke all on function public.delete_own_post(uuid) from public;
grant execute on function public.delete_own_post(uuid) to authenticated;
