-- Authors need UPDATE to set image_storage_path after storage upload + post_images insert.
-- Authors need DELETE for client rollback when upload / post_images / update fails.
-- RLS was previously insert + select only, so image posts succeeded until the final posts.update.

drop policy if exists "posts_update_own" on public.posts;
drop policy if exists "posts_delete_own" on public.posts;

create policy "posts_update_own"
  on public.posts for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "posts_delete_own"
  on public.posts for delete
  to authenticated
  using (auth.uid() = user_id);
