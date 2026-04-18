-- Per-post likes (one per user per post) + RPC helpers for counts (avoid huge select payloads).

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint likes_user_post_unique unique (user_id, post_id)
);

create index if not exists likes_post_id_idx on public.likes (post_id);
create index if not exists likes_user_id_idx on public.likes (user_id);

alter table public.likes enable row level security;

drop policy if exists "likes_insert_own" on public.likes;

create policy "likes_insert_own"
  on public.likes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "likes_delete_own" on public.likes;

create policy "likes_delete_own"
  on public.likes for delete
  to authenticated
  using (auth.uid() = user_id);

-- Aggregate like counts for a set of post ids (security definer reads through RLS).
create or replace function public.post_like_counts(p_post_ids uuid[])
returns table (post_id uuid, like_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select l.post_id, count(*)::bigint as like_count
  from public.likes l
  where l.post_id = any(p_post_ids)
  group by l.post_id;
$$;

revoke all on function public.post_like_counts(uuid[]) from public;
grant execute on function public.post_like_counts(uuid[]) to anon, authenticated;

-- Reblogs in a chain: rows sharing original_post_id, excluding the root row itself.
create or replace function public.post_reblog_counts_by_root(p_root_ids uuid[])
returns table (root_id uuid, reblog_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.original_post_id as root_id,
    count(*) filter (where p.id <> p.original_post_id)::bigint as reblog_count
  from public.posts p
  where p.original_post_id = any(p_root_ids)
  group by p.original_post_id;
$$;

revoke all on function public.post_reblog_counts_by_root(uuid[]) from public;
grant execute on function public.post_reblog_counts_by_root(uuid[]) to anon, authenticated;

-- Which posts in the list the current user has liked (empty when anonymous).
create or replace function public.post_ids_liked_by_auth_user(p_post_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select array_agg(l.post_id)
      from public.likes l
      where auth.uid() is not null
        and l.user_id = auth.uid()
        and l.post_id = any(p_post_ids)
    ),
    array[]::uuid[]
  );
$$;

revoke all on function public.post_ids_liked_by_auth_user(uuid[]) from public;
grant execute on function public.post_ids_liked_by_auth_user(uuid[]) to anon, authenticated;
