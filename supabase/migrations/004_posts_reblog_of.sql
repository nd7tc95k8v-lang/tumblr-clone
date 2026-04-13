-- Points to the post this row reblogs; original row is never modified.
alter table public.posts
  add column if not exists reblog_of uuid references public.posts (id) on delete set null;

create index if not exists posts_reblog_of_idx on public.posts (reblog_of);
