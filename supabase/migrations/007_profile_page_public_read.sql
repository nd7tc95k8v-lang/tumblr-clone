-- Optional public-facing fields
alter table public.profiles
  add column if not exists display_name text,
  add column if not exists bio text;

-- Let visitors open /profile/[username] with the anon key (read-only).
drop policy if exists "Anonymous users can read profiles with username" on public.profiles;

create policy "Anonymous users can read profiles with username"
  on public.profiles for select
  to anon
  using (username is not null);

drop policy if exists "Anonymous users can read posts" on public.posts;

create policy "Anonymous users can read posts"
  on public.posts for select
  to anon
  using (true);
