-- Lightweight notification inbox: derived from follows, likes, reblogs, and note comments.
-- Likes have no SELECT RLS for clients; read state is stored per user for unread/badge.

create table if not exists public.notification_inbox_read_state (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default '1970-01-01T00:00:00+00'
);

comment on table public.notification_inbox_read_state is
  'Single watermark per user: events with created_at > last_read_at count as unread.';

alter table public.notification_inbox_read_state enable row level security;

drop policy if exists "notification_read_state_select_own" on public.notification_inbox_read_state;

create policy "notification_read_state_select_own"
  on public.notification_inbox_read_state for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "notification_read_state_insert_own" on public.notification_inbox_read_state;

create policy "notification_read_state_insert_own"
  on public.notification_inbox_read_state for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "notification_read_state_update_own" on public.notification_inbox_read_state;

create policy "notification_read_state_update_own"
  on public.notification_inbox_read_state for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Internal: all inbox-eligible events for the current user (newest-first sort in wrappers).
create or replace function public.notification_inbox_events_raw()
returns table (
  kind text,
  created_at timestamptz,
  actor_id uuid,
  actor_username text,
  actor_avatar text,
  thread_root_post_id uuid,
  related_post_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    'follow'::text as kind,
    f.created_at,
    f.follower_id as actor_id,
    pr.username as actor_username,
    pr.avatar_url as actor_avatar,
    null::uuid as thread_root_post_id,
    null::uuid as related_post_id
  from public.follows f
  inner join public.profiles pr on pr.id = f.follower_id
  where f.following_id = auth.uid()
    and f.follower_id <> f.following_id

  union all

  select
    'like'::text,
    l.created_at,
    l.user_id,
    pr.username,
    pr.avatar_url,
    l.post_id,
    null::uuid
  from public.likes l
  inner join public.posts root on root.id = l.post_id
  inner join public.profiles pr on pr.id = l.user_id
  where root.user_id = auth.uid()
    and l.user_id <> auth.uid()

  union all

  select
    'reblog'::text,
    p.created_at,
    p.user_id,
    pr.username,
    pr.avatar_url,
    root.id,
    p.id
  from public.posts p
  inner join public.posts root on root.id = p.original_post_id
  inner join public.profiles pr on pr.id = p.user_id
  where root.user_id = auth.uid()
    and p.id <> root.id
    and p.user_id <> auth.uid()

  union all

  select
    'comment'::text,
    c.created_at,
    c.user_id,
    pr.username,
    pr.avatar_url,
    c.thread_root_post_id,
    null::uuid
  from public.post_note_comments c
  inner join public.posts root on root.id = c.thread_root_post_id
  inner join public.profiles pr on pr.id = c.user_id
  where root.user_id = auth.uid()
    and c.user_id <> auth.uid();
$$;

revoke all on function public.notification_inbox_events_raw() from public;

create or replace function public.notification_inbox_list(p_limit int default 50)
returns table (
  kind text,
  created_at timestamptz,
  actor_id uuid,
  actor_username text,
  actor_avatar text,
  thread_root_post_id uuid,
  related_post_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select e.kind, e.created_at, e.actor_id, e.actor_username, e.actor_avatar, e.thread_root_post_id, e.related_post_id
  from public.notification_inbox_events_raw() e
  order by e.created_at desc, e.kind asc, e.actor_id asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.notification_inbox_list(int) from public;
grant execute on function public.notification_inbox_list(int) to authenticated;

create or replace function public.notification_inbox_unread_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with lr as (
    select coalesce(
      (
        select r.last_read_at
        from public.notification_inbox_read_state r
        where r.user_id = auth.uid()
      ),
      'epoch'::timestamptz
    ) as t
  )
  select count(*)::bigint
  from public.notification_inbox_events_raw() e
  cross join lr
  where e.created_at > lr.t;
$$;

revoke all on function public.notification_inbox_unread_count() from public;
grant execute on function public.notification_inbox_unread_count() to authenticated;
