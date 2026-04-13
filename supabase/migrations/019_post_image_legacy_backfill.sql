-- Extended backfill: canonical image_storage_path for any URL that references bucket `post-images/`,
-- plus optional clearing of redundant image_url. Keeps bucket private and NSFW rules unchanged.
--
-- When to DROP legacy storage policies (`post-images select legacy url *` from 018):
--   After monitoring: `still_bucket_url_no_path` from scripts/post-images-legacy-audit.sql stays 0
--   across production for one or more release cycles. External hotlinked images (no post-images in URL)
--   are unrelated; they never used those policies.

do $$
declare
  n_legacy_total int;
  n_legacy_nsfw int;
  n_legacy_sfw int;
begin
  -- Before: rows depending on fragile patterns (image set, no canonical path)
  select count(*) into n_legacy_total
  from public.posts
  where image_url is not null
    and btrim(image_url) <> ''
    and (image_storage_path is null or btrim(image_storage_path) = '');

  select count(*) into n_legacy_nsfw
  from public.posts
  where image_url is not null
    and btrim(image_url) <> ''
    and (image_storage_path is null or btrim(image_storage_path) = '')
    and coalesce(is_nsfw, false);

  n_legacy_sfw := n_legacy_total - n_legacy_nsfw;

  raise notice '[019 pre] posts with image_url but no image_storage_path: total=%, nsfw=%, sfw=%',
    n_legacy_total, n_legacy_nsfw, n_legacy_sfw;
end;
$$;

-- Broader extraction: any host/path that ends with post-images/<object-path> (query/hash stripped).
-- Catches custom domains, signed/public path variants, etc., as long as `post-images/` appears once as bucket segment.
update public.posts p
set image_storage_path = v.path
from (
  select
    id,
    nullif(
      trim(
        both '/'
        from (regexp_match(
          regexp_replace(split_part(trim(image_url), '?', 1), '#.*$', ''),
          'post-images/(.+)$'
        ))[1]
      ),
      ''
    ) as path
  from public.posts
  where (image_storage_path is null or btrim(image_storage_path) = '')
    and image_url is not null
    and btrim(image_url) <> ''
    and regexp_replace(split_part(trim(image_url), '?', 1), '#.*$', '') ~* 'post-images/.+'
) v
where p.id = v.id
  and v.path is not null;

-- Remove redundant public URLs now that path is canonical (client uses signed URLs + path).
update public.posts
set image_url = null
where image_storage_path is not null
  and btrim(image_storage_path) <> ''
  and image_url is not null
  and btrim(image_url) <> ''
  and image_url ilike '%post-images%';

do $$
declare
  n_left_total int;
  n_left_bucket int;
  n_left_external int;
begin
  select count(*) into n_left_total
  from public.posts
  where image_url is not null
    and btrim(image_url) <> ''
    and (image_storage_path is null or btrim(image_storage_path) = '');

  select count(*) into n_left_bucket
  from public.posts
  where image_url is not null
    and btrim(image_url) <> ''
    and (image_storage_path is null or btrim(image_storage_path) = '')
    and image_url ilike '%post-images%';

  n_left_external := n_left_total - n_left_bucket;

  raise notice '[019 post] remaining legacy (image_url set, no path): total=%, still_post_images_url=%, external_or_other=%',
    n_left_total, n_left_bucket, n_left_external;

  if n_left_bucket > 0 then
    raise warning '[019] % row(s) still reference post-images in image_url without image_storage_path — manual fix or new URL shape.',
      n_left_bucket;
  end if;
end;
$$;
