-- Optional text added by the user when reblogging (null for originals and commentary-less reblogs).
alter table public.posts
  add column if not exists reblog_commentary text;
