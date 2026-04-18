-- Notes: list individual likes on a thread root (likes.post_id = chain root).
-- Direct SELECT on public.likes is blocked by RLS; this mirrors post_like_counts (security definer).

create or replace function public.post_likes_list_for_thread_root(
  p_root_post_id uuid,
  p_limit int default 50
)
returns table (
  user_id uuid,
  acted_at timestamptz,
  username text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.user_id,
    l.created_at as acted_at,
    pr.username,
    pr.avatar_url
  from public.likes l
  left join public.profiles pr on pr.id = l.user_id
  where l.post_id = p_root_post_id
  order by l.created_at desc, l.user_id asc
  limit greatest(0, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.post_likes_list_for_thread_root(uuid, int) from public;
grant execute on function public.post_likes_list_for_thread_root(uuid, int) to anon, authenticated;
