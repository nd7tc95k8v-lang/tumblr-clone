-- Allow follower/following counts on any profile (insert/delete still restricted).
drop policy if exists "follows_select_as_follower" on public.follows;

drop policy if exists "follows_select_public" on public.follows;

create policy "follows_select_public"
  on public.follows for select
  to anon, authenticated
  using (true);
