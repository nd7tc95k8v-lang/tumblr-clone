-- Stable chain root: originals use original_post_id = id; reblogs inherit root.

alter table public.posts
  add column if not exists original_post_id uuid;

update public.posts
set original_post_id = id
where reblog_of is null
  and original_post_id is null;

with recursive chain as (
  select id, reblog_of, id as root_id
  from public.posts
  where reblog_of is null

  union all

  select p.id, p.reblog_of, c.root_id
  from public.posts p
  inner join chain c on p.reblog_of = c.id
)
update public.posts p
set original_post_id = chain.root_id
from chain
where p.id = chain.id
  and p.reblog_of is not null;

update public.posts
set original_post_id = id
where original_post_id is null;

do $$
declare
  n_null bigint;
begin
  select count(*) into n_null
  from public.posts
  where original_post_id is null;

  if n_null > 0 then
    raise exception
      'Migration 009: cannot set posts.original_post_id to NOT NULL because % row(s) still have NULL after backfill updates. Fix broken reblog chains or orphaned rows, then re-run. Inspect: SELECT id, user_id, reblog_of, original_post_id FROM public.posts WHERE original_post_id IS NULL LIMIT 50;',
      n_null;
  end if;

  execute 'alter table public.posts alter column original_post_id set not null';
end $$;

alter table public.posts
  drop constraint if exists posts_original_post_id_fkey;

alter table public.posts
  add constraint posts_original_post_id_fkey
  foreign key (original_post_id) references public.posts (id) on delete restrict
  deferrable initially deferred;

create index if not exists posts_original_post_id_idx on public.posts (original_post_id);

create or replace function public.posts_set_original_post_id()
returns trigger
language plpgsql
as $$
begin
  if new.reblog_of is null then
    new.original_post_id := new.id;
  elsif new.original_post_id is null then
    select coalesce(p.original_post_id, p.id)
    into new.original_post_id
    from public.posts p
    where p.id = new.reblog_of;
    if new.original_post_id is null then
      new.original_post_id := new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_set_original_post_id_trigger on public.posts;
create trigger posts_set_original_post_id_trigger
  before insert on public.posts
  for each row
  execute function public.posts_set_original_post_id();
