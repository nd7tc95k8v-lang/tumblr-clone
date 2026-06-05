-- Author delete: reblog rows delete alone; thread roots delete only when no other users' reblogs
-- still reference original_post_id (009 posts_original_post_id_fkey ON DELETE RESTRICT).

create or replace function public.delete_own_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_post public.posts%rowtype;
  v_is_thread_root boolean;
  v_foreign_reblogs bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_post_id is null then
    raise exception 'p_post_id required';
  end if;

  select * into v_post from public.posts where id = p_post_id;
  if not found then
    return;
  end if;

  if v_post.user_id is distinct from v_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_is_thread_root := (v_post.original_post_id = v_post.id);

  if v_is_thread_root then
    select count(*) into v_foreign_reblogs
    from public.posts p
    where p.original_post_id = v_post.id
      and p.id <> v_post.id
      and p.user_id is distinct from v_user_id;

    if v_foreign_reblogs > 0 then
      raise exception
        'This post still has reblogs from other users. Delete your own reblogs instead, or leave the original in place.'
        using errcode = '23503';
    end if;

    -- Own reblogs in the thread (if any), then the root row.
    delete from public.posts
    where original_post_id = v_post.id
      and id <> v_post.id
      and user_id = v_user_id;

    delete from public.posts
    where id = v_post.id
      and user_id = v_user_id;

    return;
  end if;

  delete from public.posts
  where id = p_post_id
    and user_id = v_user_id;
end;
$$;

comment on function public.delete_own_post(uuid) is
  'Author-only delete. Non-root rows: single post. Thread root: removes author''s reblogs in the thread then the root; blocked while other users still have reblogs on this original_post_id.';

revoke all on function public.delete_own_post(uuid) from public;
grant execute on function public.delete_own_post(uuid) to authenticated;
