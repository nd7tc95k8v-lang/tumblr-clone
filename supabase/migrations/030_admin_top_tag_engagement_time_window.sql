-- Optional time window: only posts in `expanded` with created_at within the window.
-- Lifetime behavior when time_window is NULL (default). Replaces single-arg overload.

drop function if exists public.admin_top_tag_engagement(integer);

create or replace function public.admin_top_tag_engagement(
  limit_count integer default 50,
  time_window interval default null
)
returns table (
  tag text,
  post_count bigint,
  total_likes bigint,
  total_reblogs bigint,
  engagement_score bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with lim as (
    select greatest(1, least(coalesce(limit_count, 50), 500))::int as n
  ),
  expanded as (
    select
      p.id as post_id,
      p.original_post_id as root_id,
      trim(both from t::text) as tag
    from public.posts p
    cross join lateral unnest(p.tags) as u(t)
    where p.tags is not null
      and cardinality(p.tags) > 0
      and t is not null
      and length(trim(both from t::text)) > 0
      and (
        time_window is null
        or p.created_at >= now() - time_window
      )
  ),
  tag_roots as (
    select distinct tag, root_id
    from expanded
  ),
  tag_post_counts as (
    select e.tag, count(distinct e.post_id)::bigint as post_count
    from expanded e
    group by e.tag
  ),
  likes_by_root as (
    select l.post_id as root_id, count(*)::bigint as like_count
    from public.likes l
    group by l.post_id
  ),
  reblogs_by_root as (
    select
      p.original_post_id as root_id,
      count(*) filter (where p.id <> p.original_post_id)::bigint as reblog_count
    from public.posts p
    group by p.original_post_id
  ),
  tag_engagement as (
    select
      tr.tag,
      coalesce(sum(coalesce(lbr.like_count, 0)), 0)::bigint as total_likes,
      coalesce(sum(coalesce(rbr.reblog_count, 0)), 0)::bigint as total_reblogs
    from tag_roots tr
    left join likes_by_root lbr on lbr.root_id = tr.root_id
    left join reblogs_by_root rbr on rbr.root_id = tr.root_id
    group by tr.tag
  )
  select
    te.tag,
    tpc.post_count,
    te.total_likes,
    te.total_reblogs,
    (te.total_likes + te.total_reblogs * 2)::bigint as engagement_score
  from tag_engagement te
  inner join tag_post_counts tpc on tpc.tag = te.tag
  cross join lim
  order by engagement_score desc, te.tag asc
  limit (select lim.n from lim);
$$;

revoke all on function public.admin_top_tag_engagement(integer, interval) from public;
grant execute on function public.admin_top_tag_engagement(integer, interval) to service_role;
