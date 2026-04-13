-- Who follows whom (both ids reference profiles = auth user ids).

create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create index if not exists follows_following_id_idx on public.follows (following_id);
create index if not exists follows_follower_id_idx on public.follows (follower_id);

alter table public.follows enable row level security;

create policy "follows_select_as_follower"
  on public.follows for select
  to authenticated
  using (follower_id = auth.uid());

create policy "follows_insert_own"
  on public.follows for insert
  to authenticated
  with check (
    follower_id = auth.uid()
    and follower_id <> following_id
  );

create policy "follows_delete_own"
  on public.follows for delete
  to authenticated
  using (follower_id = auth.uid());
