-- Fix delete/update failures for reblog rows that denormalize the parent's image_storage_path.
--
-- Root cause: posts_validate_image_storage_path (018) enforces user_id/ prefix only when reblog_of IS NULL.
-- Reblogs may copy the parent's path (reblog.ts, 019 backfill). That is allowed while reblog_of is set.
-- posts.reblog_of references posts(id) ON DELETE SET NULL (004): deleting a parent UPDATEs children to
-- reblog_of = NULL, which re-runs the trigger as if the row were an original → exception.
-- Direct DELETE of a leaf reblog row does not fire this trigger; failures surface when the delete
-- cascades SET NULL to other posts, or when a row is updated after reblog_of was cleared.
--
-- Fix: on reblog_of → NULL, clear non-author-owned image_storage_path (post_images gallery unchanged).
-- Data cleanup: same for existing reblog rows; preserve post_images for inherited media.

-- ---------------------------------------------------------------------------
-- 1. Trigger: inherit cleanup on parent delete (SET NULL), keep strict rules for true originals
-- ---------------------------------------------------------------------------
create or replace function public.posts_validate_image_storage_path()
returns trigger
language plpgsql
as $$
declare
  p text;
begin
  -- Parent post removed: child reblog_of becomes NULL via FK. Drop inherited canonical path only.
  if tg_op = 'UPDATE'
     and old.reblog_of is not null
     and new.reblog_of is null
     and nullif(btrim(coalesce(new.image_storage_path, '')), '') is not null
     and new.image_storage_path not like new.user_id::text || '/%'
  then
    new.image_storage_path := null;
    return new;
  end if;

  p := nullif(btrim(coalesce(new.image_storage_path, '')), '');
  if p is null then
    return new;
  end if;

  -- Original posts and orphaned rows (reblog_of null): path must live under author folder.
  if new.reblog_of is null then
    if p not like new.user_id::text || '/%' then
      raise exception 'image_storage_path must start with the author user_id prefix'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. One-time cleanup: reblog rows with parent-owned posts.image_storage_path
-- ---------------------------------------------------------------------------
update public.posts p
set image_storage_path = null
where p.reblog_of is not null
  and nullif(btrim(coalesce(p.image_storage_path, '')), '') is not null
  and split_part(btrim(p.image_storage_path), '/', 1) is distinct from p.user_id::text;
