-- Flat, thread-root–scoped note comments (Tumblr-style “say something” on notes, not threaded replies).
-- RLS mirrors post visibility via EXISTS on posts (inherits NSFW policies) and reuses human-check + a light rate limit.

create table if not exists public.post_note_comments (
  id uuid primary key default gen_random_uuid(),
  thread_root_post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint post_note_comments_body_nonempty check (char_length(btrim(body)) > 0),
  constraint post_note_comments_body_len check (char_length(body) <= 500)
);

comment on table public.post_note_comments is
  'Short public comments attached to a thread root; shown in Notes modal only; not threaded.';

create index if not exists post_note_comments_root_created_idx
  on public.post_note_comments (thread_root_post_id, created_at desc);

create index if not exists post_note_comments_user_created_idx
  on public.post_note_comments (user_id, created_at desc);

alter table public.post_note_comments enable row level security;

create or replace function public.post_note_comment_insert_rate_ok(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select count(*)::int < 20
      from public.post_note_comments c
      where c.user_id = p_user
        and c.created_at > now() - interval '1 minute'
    ),
    true
  );
$$;

revoke all on function public.post_note_comment_insert_rate_ok(uuid) from public;
grant execute on function public.post_note_comment_insert_rate_ok(uuid) to authenticated;

drop policy if exists "post_note_comments_select_visible_post" on public.post_note_comments;

create policy "post_note_comments_select_visible_post"
  on public.post_note_comments for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.posts p
      where p.id = post_note_comments.thread_root_post_id
    )
  );

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
    and public.human_check_fresh(auth.uid())
    and public.post_note_comment_insert_rate_ok(auth.uid())
  );

drop policy if exists "post_note_comments_delete_own" on public.post_note_comments;

create policy "post_note_comments_delete_own"
  on public.post_note_comments for delete
  to authenticated
  using (
    user_id = auth.uid()
    and public.human_check_fresh(auth.uid())
  );

-- Batched counts for feed engagement (mirrors post_reblog_counts_by_root).
create or replace function public.post_note_comment_counts_by_root(p_root_ids uuid[])
returns table (root_id uuid, comment_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.thread_root_post_id as root_id,
    count(*)::bigint as comment_count
  from public.post_note_comments c
  where c.thread_root_post_id = any(p_root_ids)
  group by c.thread_root_post_id;
$$;

revoke all on function public.post_note_comment_counts_by_root(uuid[]) from public;
grant execute on function public.post_note_comment_counts_by_root(uuid[]) to anon, authenticated;
