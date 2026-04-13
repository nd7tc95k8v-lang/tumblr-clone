-- Comma-separated tags in the app are normalized and stored as a text array.
alter table public.posts
  add column if not exists tags text[] not null default '{}';

create index if not exists posts_tags_gin_idx on public.posts using gin (tags);
