-- Optional image for each post (public URL from Supabase Storage).
alter table public.posts
  add column if not exists image_url text;
