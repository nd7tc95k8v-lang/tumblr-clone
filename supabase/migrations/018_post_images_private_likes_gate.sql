-- Private post-images bucket (no anonymous public URLs) + RLS tied to post visibility.
-- Tighten likes insert to match post NSFW / adult-access rules.

-- ---------------------------------------------------------------------------
-- posts: canonical storage path inside bucket `post-images` (e.g. user_id/uuid.jpg)
-- ---------------------------------------------------------------------------
alter table public.posts
  add column if not exists image_storage_path text;

comment on column public.posts.image_storage_path is
  'Object path in storage bucket post-images; client uses createSignedUrl. Legacy rows may rely on image_url until backfilled.';

-- Best-effort backfill from Supabase public object URLs (adjust pattern if you use a custom CDN host).
update public.posts
set image_storage_path = regexp_replace(image_url, '^https?://[^/]+/storage/v1/object/public/post-images/', '')
where image_storage_path is null
  and image_url is not null
  and image_url like '%/storage/v1/object/public/post-images/%';

-- ---------------------------------------------------------------------------
-- Original posts: storage path must live under posts.user_id/ (reblogs may reuse parent path).
-- ---------------------------------------------------------------------------
create or replace function public.posts_validate_image_storage_path()
returns trigger
language plpgsql
as $$
declare
  p text;
begin
  p := nullif(btrim(coalesce(new.image_storage_path, '')), '');
  if p is null then
    return new;
  end if;
  if new.reblog_of is null then
    if p not like new.user_id::text || '/%' then
      raise exception 'image_storage_path must start with the author user_id prefix'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_validate_image_storage_path_trigger on public.posts;
create trigger posts_validate_image_storage_path_trigger
  before insert or update on public.posts
  for each row
  execute function public.posts_validate_image_storage_path();

-- ---------------------------------------------------------------------------
-- Storage: post-images is private; read allowed if uploader or a visible post references the object.
-- ---------------------------------------------------------------------------
update storage.buckets
set public = false
where id = 'post-images';

drop policy if exists "post-images select public" on storage.objects;

-- Uploader can always read their own objects (upload flow + debugging).
create policy "post-images select own folder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- Signed URL / API read when some post row references this object and reader may see that post (SFW or adult OK).
create policy "post-images select via visible post authenticated"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-images'
    and exists (
      select 1
      from public.posts p
      where p.image_storage_path = storage.objects.name
        and (
          not coalesce(p.is_nsfw, false)
          or public.adult_content_access_ok(auth.uid())
        )
    )
  );

create policy "post-images select via sfw post anon"
  on storage.objects for select
  to anon
  using (
    bucket_id = 'post-images'
    and exists (
      select 1
      from public.posts p
      where p.image_storage_path = storage.objects.name
        and not coalesce(p.is_nsfw, false)
    )
  );

-- Legacy: rows not yet backfilled (image_storage_path null) still tied by image_url suffix match.
create policy "post-images select legacy url authenticated"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-images'
    and exists (
      select 1
      from public.posts p
      where p.image_storage_path is null
        and p.image_url is not null
        and p.image_url like '%/' || storage.objects.name
        and (
          not coalesce(p.is_nsfw, false)
          or public.adult_content_access_ok(auth.uid())
        )
    )
  );

create policy "post-images select legacy url anon sfw"
  on storage.objects for select
  to anon
  using (
    bucket_id = 'post-images'
    and exists (
      select 1
      from public.posts p
      where p.image_storage_path is null
        and p.image_url is not null
        and p.image_url like '%/' || storage.objects.name
        and not coalesce(p.is_nsfw, false)
    )
  );

-- ---------------------------------------------------------------------------
-- Likes: cannot like a post the viewer is not allowed to SELECT under post RLS.
-- ---------------------------------------------------------------------------
drop policy if exists "likes_insert_own" on public.likes;

create policy "likes_insert_own_visible_post"
  on public.likes for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.posts p
      where p.id = post_id
        and (
          not coalesce(p.is_nsfw, false)
          or public.adult_content_access_ok(auth.uid())
        )
    )
  );
