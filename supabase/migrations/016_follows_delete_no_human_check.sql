-- Unfollow should not require a fresh human check; insert stays guarded (014).

drop policy if exists "follows_delete_own" on public.follows;

create policy "follows_delete_own"
  on public.follows for delete
  to authenticated
  using (follower_id = auth.uid());
