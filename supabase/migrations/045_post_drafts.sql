-- Original post drafts (compose autosave / draft list). Reblog drafts and queue are out of scope here.

-- ---------------------------------------------------------------------------
-- post_drafts
-- ---------------------------------------------------------------------------
create table if not exists public.post_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null default '',
  tags text[] not null default '{}',
  is_nsfw boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint post_drafts_tags_max_count check (cardinality(tags) <= 30)
);

create index if not exists post_drafts_user_updated_idx
  on public.post_drafts (user_id, updated_at desc);

comment on table public.post_drafts is
  'Author-owned original post drafts; publish copies into public.posts in a later phase.';

-- ---------------------------------------------------------------------------
-- post_draft_images
-- ---------------------------------------------------------------------------
create table if not exists public.post_draft_images (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.post_drafts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint post_draft_images_draft_position_unique unique (draft_id, position),
  constraint post_draft_images_draft_storage_path_unique unique (draft_id, storage_path),
  constraint post_draft_images_storage_path_prefix check (
    storage_path like user_id::text || '/drafts/%'
  )
);

create index if not exists post_draft_images_draft_id_position_idx
  on public.post_draft_images (draft_id, position);

comment on table public.post_draft_images is
  'Ordered draft attachments in bucket post-images under {user_id}/drafts/...';

-- Keep post_draft_images.user_id aligned with the parent draft owner.
create or replace function public.post_draft_images_enforce_draft_owner()
returns trigger
language plpgsql
as $$
declare
  v_draft_user uuid;
begin
  select d.user_id into v_draft_user
  from public.post_drafts d
  where d.id = new.draft_id;

  if v_draft_user is null then
    raise exception 'post_draft_images: draft not found'
      using errcode = '23503';
  end if;

  if new.user_id is distinct from v_draft_user then
    raise exception 'post_draft_images.user_id must match post_drafts.user_id'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists post_draft_images_enforce_draft_owner_trigger on public.post_draft_images;
create trigger post_draft_images_enforce_draft_owner_trigger
  before insert or update on public.post_draft_images
  for each row
  execute function public.post_draft_images_enforce_draft_owner();

-- Touch parent draft updated_at when images change (future list sort accuracy).
create or replace function public.post_drafts_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  update public.post_drafts
  set updated_at = now()
  where id = coalesce(new.draft_id, old.draft_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists post_draft_images_touch_draft_updated_at_trigger on public.post_draft_images;
create trigger post_draft_images_touch_draft_updated_at_trigger
  after insert or update or delete on public.post_draft_images
  for each row
  execute function public.post_drafts_touch_updated_at();

create or replace function public.post_drafts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists post_drafts_set_updated_at_trigger on public.post_drafts;
create trigger post_drafts_set_updated_at_trigger
  before update on public.post_drafts
  for each row
  execute function public.post_drafts_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: post_drafts (author-only, no public read)
-- ---------------------------------------------------------------------------
alter table public.post_drafts enable row level security;

drop policy if exists "post_drafts_select_own" on public.post_drafts;
create policy "post_drafts_select_own"
  on public.post_drafts for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "post_drafts_insert_own" on public.post_drafts;
create policy "post_drafts_insert_own"
  on public.post_drafts for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "post_drafts_update_own" on public.post_drafts;
create policy "post_drafts_update_own"
  on public.post_drafts for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "post_drafts_delete_own" on public.post_drafts;
create policy "post_drafts_delete_own"
  on public.post_drafts for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RLS: post_draft_images (author-only; parent draft must belong to caller)
-- ---------------------------------------------------------------------------
alter table public.post_draft_images enable row level security;

drop policy if exists "post_draft_images_select_own" on public.post_draft_images;
create policy "post_draft_images_select_own"
  on public.post_draft_images for select
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.post_drafts d
      where d.id = post_draft_images.draft_id
        and d.user_id = auth.uid()
    )
  );

drop policy if exists "post_draft_images_insert_own" on public.post_draft_images;
create policy "post_draft_images_insert_own"
  on public.post_draft_images for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.post_drafts d
      where d.id = draft_id
        and d.user_id = auth.uid()
    )
  );

drop policy if exists "post_draft_images_update_own" on public.post_draft_images;
create policy "post_draft_images_update_own"
  on public.post_draft_images for update
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.post_drafts d
      where d.id = post_draft_images.draft_id
        and d.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.post_drafts d
      where d.id = draft_id
        and d.user_id = auth.uid()
    )
  );

drop policy if exists "post_draft_images_delete_own" on public.post_draft_images;
create policy "post_draft_images_delete_own"
  on public.post_draft_images for delete
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.post_drafts d
      where d.id = post_draft_images.draft_id
        and d.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: draft objects under {auth.uid()}/drafts/ in private bucket post-images.
-- Existing first-folder insert/select/delete policies already allow {uid}/drafts/...;
-- explicit draft-subfolder policies document intent without widening published-post paths.
-- ---------------------------------------------------------------------------
drop policy if exists "post-images insert own drafts subfolder" on storage.objects;
create policy "post-images insert own drafts subfolder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and name like (auth.uid())::text || '/drafts/%'
  );

drop policy if exists "post-images select own drafts subfolder" on storage.objects;
create policy "post-images select own drafts subfolder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-images'
    and name like (auth.uid())::text || '/drafts/%'
  );

drop policy if exists "post-images delete own drafts subfolder" on storage.objects;
create policy "post-images delete own drafts subfolder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'post-images'
    and name like (auth.uid())::text || '/drafts/%'
  );
