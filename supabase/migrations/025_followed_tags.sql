-- Per-user followed tags (one row per user per tag). Feed wiring comes later.

create table if not exists public.followed_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tag text not null,
  created_at timestamptz default now(),
  constraint followed_tags_user_tag_unique unique (user_id, tag)
);

create index if not exists followed_tags_user_id_idx on public.followed_tags (user_id);

alter table public.followed_tags enable row level security;

drop policy if exists "followed_tags_select_own" on public.followed_tags;

create policy "followed_tags_select_own"
  on public.followed_tags for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "followed_tags_insert_own" on public.followed_tags;

create policy "followed_tags_insert_own"
  on public.followed_tags for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "followed_tags_delete_own" on public.followed_tags;

create policy "followed_tags_delete_own"
  on public.followed_tags for delete
  to authenticated
  using (auth.uid() = user_id);
