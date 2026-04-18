-- Allow authors to remove objects they uploaded under `{auth.uid()}/...` (rollback + delete post flows).

drop policy if exists "post-images delete own folder" on storage.objects;

create policy "post-images delete own folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
