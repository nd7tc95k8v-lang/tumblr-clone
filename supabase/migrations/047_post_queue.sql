-- Original post queue (scheduled / ordered publish). Reblog queue and worker are out of scope here.

-- ---------------------------------------------------------------------------
-- post_queue
-- ---------------------------------------------------------------------------
create table if not exists public.post_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null default '',
  tags text[] not null default '{}',
  is_nsfw boolean not null default false,
  queue_position integer not null default 0,
  scheduled_for timestamptz null,
  status text not null default 'queued',
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint post_queue_tags_max_count check (cardinality(tags) <= 30),
  constraint post_queue_tags_element_len check (
    not exists (
      select 1
      from unnest(tags) as t(tag)
      where char_length(tag) > 40
    )
  ),
  constraint post_queue_status_valid check (status in ('queued', 'publishing', 'failed')),
  constraint post_queue_user_position_unique unique (user_id, queue_position)
);

create index if not exists post_queue_user_position_idx
  on public.post_queue (user_id, queue_position);

create index if not exists post_queue_user_created_idx
  on public.post_queue (user_id, created_at);

comment on table public.post_queue is
  'Author-owned original posts awaiting ordered or scheduled publish; worker copies into public.posts in a later phase.';

-- ---------------------------------------------------------------------------
-- post_queue_images
-- ---------------------------------------------------------------------------
create table if not exists public.post_queue_images (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.post_queue (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint post_queue_images_queue_position_unique unique (queue_id, position),
  constraint post_queue_images_queue_storage_path_unique unique (queue_id, storage_path),
  constraint post_queue_images_storage_path_prefix check (
    storage_path like user_id::text || '/queue/%'
  )
);

create index if not exists post_queue_images_queue_id_position_idx
  on public.post_queue_images (queue_id, position);

comment on table public.post_queue_images is
  'Ordered queue attachments in bucket post-images under {user_id}/queue/...';

-- Keep post_queue_images.user_id aligned with the parent queue owner.
create or replace function public.post_queue_images_enforce_queue_owner()
returns trigger
language plpgsql
as $$
declare
  v_queue_user uuid;
begin
  select q.user_id into v_queue_user
  from public.post_queue q
  where q.id = new.queue_id;

  if v_queue_user is null then
    raise exception 'post_queue_images: queue item not found'
      using errcode = '23503';
  end if;

  if new.user_id is distinct from v_queue_user then
    raise exception 'post_queue_images.user_id must match post_queue.user_id'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists post_queue_images_enforce_queue_owner_trigger on public.post_queue_images;
create trigger post_queue_images_enforce_queue_owner_trigger
  before insert or update on public.post_queue_images
  for each row
  execute function public.post_queue_images_enforce_queue_owner();

-- Touch parent queue updated_at when images change.
create or replace function public.post_queue_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  update public.post_queue
  set updated_at = now()
  where id = coalesce(new.queue_id, old.queue_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists post_queue_images_touch_queue_updated_at_trigger on public.post_queue_images;
create trigger post_queue_images_touch_queue_updated_at_trigger
  after insert or update or delete on public.post_queue_images
  for each row
  execute function public.post_queue_touch_updated_at();

create or replace function public.post_queue_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists post_queue_set_updated_at_trigger on public.post_queue;
create trigger post_queue_set_updated_at_trigger
  before update on public.post_queue
  for each row
  execute function public.post_queue_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: post_queue (author-only, no public read)
-- ---------------------------------------------------------------------------
alter table public.post_queue enable row level security;

drop policy if exists "post_queue_select_own" on public.post_queue;
create policy "post_queue_select_own"
  on public.post_queue for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "post_queue_insert_own" on public.post_queue;
create policy "post_queue_insert_own"
  on public.post_queue for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "post_queue_update_own" on public.post_queue;
create policy "post_queue_update_own"
  on public.post_queue for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "post_queue_delete_own" on public.post_queue;
create policy "post_queue_delete_own"
  on public.post_queue for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RLS: post_queue_images (author-only; parent queue must belong to caller)
-- ---------------------------------------------------------------------------
alter table public.post_queue_images enable row level security;

drop policy if exists "post_queue_images_select_own" on public.post_queue_images;
create policy "post_queue_images_select_own"
  on public.post_queue_images for select
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.post_queue q
      where q.id = post_queue_images.queue_id
        and q.user_id = auth.uid()
    )
  );

drop policy if exists "post_queue_images_insert_own" on public.post_queue_images;
create policy "post_queue_images_insert_own"
  on public.post_queue_images for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.post_queue q
      where q.id = queue_id
        and q.user_id = auth.uid()
    )
  );

drop policy if exists "post_queue_images_update_own" on public.post_queue_images;
create policy "post_queue_images_update_own"
  on public.post_queue_images for update
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.post_queue q
      where q.id = post_queue_images.queue_id
        and q.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.post_queue q
      where q.id = queue_id
        and q.user_id = auth.uid()
    )
  );

drop policy if exists "post_queue_images_delete_own" on public.post_queue_images;
create policy "post_queue_images_delete_own"
  on public.post_queue_images for delete
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.post_queue q
      where q.id = post_queue_images.queue_id
        and q.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: queue objects under {auth.uid()}/queue/ in private bucket post-images.
-- ---------------------------------------------------------------------------
drop policy if exists "post-images insert own queue subfolder" on storage.objects;
create policy "post-images insert own queue subfolder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and name like (auth.uid())::text || '/queue/%'
  );

drop policy if exists "post-images select own queue subfolder" on storage.objects;
create policy "post-images select own queue subfolder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-images'
    and name like (auth.uid())::text || '/queue/%'
  );

drop policy if exists "post-images delete own queue subfolder" on storage.objects;
create policy "post-images delete own queue subfolder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'post-images'
    and name like (auth.uid())::text || '/queue/%'
  );
