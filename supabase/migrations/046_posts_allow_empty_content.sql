-- Allow image-only original posts.
-- 001_posts.sql enforced char_length(content) > 0, which blocked publish when PostForm sent '' with images.
-- Publish validation remains in the app (PostForm): text and/or images required; tags-only publish still blocked.

alter table public.posts
  alter column content set default '';

alter table public.posts
  drop constraint if exists posts_content_check;
