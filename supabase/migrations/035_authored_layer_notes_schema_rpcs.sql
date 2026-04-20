-- Authored-layer / per-card Notes — additive schema + RPCs (no app wiring yet).
-- Preserves: post_note_comments.thread_root_post_id, post_note_comment_counts_by_root,
-- post_reblog_counts_by_root, post_likes_list_for_thread_root (unchanged).
-- See IMPLEMENTATION.md — "Planned DB / RPC expansion — authored-layer Notes".

-- ---------------------------------------------------------------------------
-- 1. Schema: second anchor on flat note comments
-- ---------------------------------------------------------------------------

alter table public.post_note_comments
  add column if not exists note_anchor_post_id uuid references public.posts (id) on delete set null;

comment on column public.post_note_comments.note_anchor_post_id is
  'Authored-layer / card-owner post id for Tumblr-style per-card Notes; null for legacy rows until backfill. thread_root_post_id remains the chain root for visibility and thread-scoped RPCs.';

create index if not exists post_note_comments_anchor_created_idx
  on public.post_note_comments (note_anchor_post_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. RLS: allow inserts when anchor is set (post row must exist)
-- ---------------------------------------------------------------------------

drop policy if exists "post_note_comments_insert_guarded" on public.post_note_comments;

create policy "post_note_comments_insert_guarded"
  on public.post_note_comments for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.posts p
      where p.id = post_note_comments.thread_root_post_id
    )
    and (
      post_note_comments.note_anchor_post_id is null
      or exists (
        select 1
        from public.posts pa
        where pa.id = post_note_comments.note_anchor_post_id
      )
    )
    and public.human_check_fresh(auth.uid())
    and public.post_note_comment_insert_rate_ok(auth.uid())
  );

-- SELECT / DELETE policies unchanged (thread_root_post_id–centric visibility).

-- ---------------------------------------------------------------------------
-- 3. RPC: immediate child reblog counts (reblog_of = parent), batched
-- ---------------------------------------------------------------------------

create or replace function public.post_reblog_counts_by_immediate_parent(p_parent_post_ids uuid[])
returns table (parent_post_id uuid, reblog_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.reblog_of as parent_post_id,
    count(*)::bigint as reblog_count
  from public.posts p
  where p.reblog_of is not null
    and p.reblog_of = any(p_parent_post_ids)
  group by p.reblog_of;
$$;

revoke all on function public.post_reblog_counts_by_immediate_parent(uuid[]) from public;
grant execute on function public.post_reblog_counts_by_immediate_parent(uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC: note comment counts keyed by authored-layer anchor (batched)
-- ---------------------------------------------------------------------------

create or replace function public.post_note_comment_counts_by_anchor(p_anchor_ids uuid[])
returns table (anchor_post_id uuid, comment_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.note_anchor_post_id as anchor_post_id,
    count(*)::bigint as comment_count
  from public.post_note_comments c
  where c.note_anchor_post_id is not null
    and c.note_anchor_post_id = any(p_anchor_ids)
  group by c.note_anchor_post_id;
$$;

revoke all on function public.post_note_comment_counts_by_anchor(uuid[]) from public;
grant execute on function public.post_note_comment_counts_by_anchor(uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC: list note comments for one anchor (Notes modal merge; definer read)
-- ---------------------------------------------------------------------------

create or replace function public.post_note_comments_list_for_anchor(
  p_anchor_post_id uuid,
  p_limit int default 50
)
returns table (
  id uuid,
  created_at timestamptz,
  user_id uuid,
  body text,
  username text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.created_at,
    c.user_id,
    c.body,
    pr.username,
    pr.avatar_url
  from public.post_note_comments c
  left join public.profiles pr on pr.id = c.user_id
  where c.note_anchor_post_id = p_anchor_post_id
  order by c.created_at desc, c.id desc
  limit greatest(0, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.post_note_comments_list_for_anchor(uuid, int) from public;
grant execute on function public.post_note_comments_list_for_anchor(uuid, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC: list immediate child reblogs for one parent post (Notes modal merge)
-- ---------------------------------------------------------------------------

create or replace function public.post_immediate_reblogs_list_for_parent(
  p_parent_post_id uuid,
  p_limit int default 50
)
returns table (
  id uuid,
  created_at timestamptz,
  user_id uuid,
  reblog_commentary text,
  username text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.created_at,
    p.user_id,
    p.reblog_commentary,
    pr.username,
    pr.avatar_url
  from public.posts p
  left join public.profiles pr on pr.id = p.user_id
  where p.reblog_of = p_parent_post_id
  order by p.created_at desc, p.id desc
  limit greatest(0, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.post_immediate_reblogs_list_for_parent(uuid, int) from public;
grant execute on function public.post_immediate_reblogs_list_for_parent(uuid, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Phase B backfill (run manually when enabling dual-write; not executed here):
--   update public.post_note_comments
--   set note_anchor_post_id = thread_root_post_id
--   where note_anchor_post_id is null;
-- Makes anchor-scoped counts at the thread root match legacy thread totals until UI splits semantics.
-- ---------------------------------------------------------------------------
