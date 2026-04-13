-- Read-only audit: run in Supabase SQL editor or `psql` after migrations.
-- Use counts to decide when legacy storage RLS policies can be removed (see 019 header comment).

-- 1) Any row still missing canonical path while having an image URL
select
  count(*) as legacy_total,
  count(*) filter (where coalesce(is_nsfw, false)) as legacy_nsfw,
  count(*) filter (where not coalesce(is_nsfw, false)) as legacy_sfw
from public.posts
where image_url is not null
  and btrim(image_url) <> ''
  and (image_storage_path is null or btrim(image_storage_path) = '');

-- 2) Subset that still looks like our bucket (should be zero after 019 backfill)
select count(*) as legacy_still_post_images_pattern
from public.posts
where image_url is not null
  and btrim(image_url) <> ''
  and (image_storage_path is null or btrim(image_storage_path) = '')
  and image_url ilike '%post-images%';

-- 3) Sample rows for manual repair (limit)
select id, user_id, is_nsfw, left(image_url, 120) as image_url_prefix, image_storage_path
from public.posts
where image_url is not null
  and btrim(image_url) <> ''
  and (image_storage_path is null or btrim(image_storage_path) = '')
  and image_url ilike '%post-images%'
order by created_at desc
limit 25;
