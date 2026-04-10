-- Run in Supabase SQL Editor or via CLI migration.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(content) > 0),
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);

alter table public.posts enable row level security;

create policy "Authenticated users can read posts"
  on public.posts for select
  to authenticated
  using (true);

create policy "Users insert own posts"
  on public.posts for insert
  to authenticated
  with check (auth.uid() = user_id);
