-- Multiple images per post: `post_images` rows + storage read via join (legacy `posts.image_*` unchanged).

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  storage_path text not null,
  "position" integer not null,
  created_at timestamptz not null default now(),
  constraint post_images_post_position_unique unique (post_id, "position")
);

create index if not exists post_images_post_id_position_idx
  on public.post_images (post_id, "position");

comment on table public.post_images is
  'Ordered gallery images for a post; paths live in bucket post-images. Legacy single-image posts may only set posts.image_storage_path.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.post_images enable row level security;

-- Read when the parent post is visible (same NSFW rules as posts).
create policy "post_images_select_via_post_anon"
  on public.post_images for select
  to anon
  using (
    exists (
      select 1
      from public.posts p
      where p.id = post_images.post_id
        and not coalesce(p.is_nsfw, false)
    )
  );

create policy "post_images_select_via_post_authenticated"
  on public.post_images for select
  to authenticated
  using (
    exists (
      select 1
      from public.posts p
      where p.id = post_images.post_id
        and (
          not coalesce(p.is_nsfw, false)
          or public.adult_content_access_ok(auth.uid())
        )
    )
  );

-- Insert only for own posts; path must live under author folder (same rule as posts.image_storage_path).
create policy "post_images_insert_own_post"
  on public.post_images for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.posts p
      where p.id = post_images.post_id
        and p.user_id = auth.uid()
        and p.reblog_of is null
        and storage_path like (auth.uid())::text || '/%'
    )
  );

create policy "post_images_delete_own_post"
  on public.post_images for delete
  to authenticated
  using (
    exists (
      select 1
      from public.posts p
      where p.id = post_images.post_id
        and p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: allow read when path is referenced by post_images + post visible
-- ---------------------------------------------------------------------------
create policy "post-images select via post_images authenticated"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-images'
    and exists (
      select 1
      from public.post_images pi
      join public.posts p on p.id = pi.post_id
      where pi.storage_path = storage.objects.name
        and (
          not coalesce(p.is_nsfw, false)
          or public.adult_content_access_ok(auth.uid())
        )
    )
  );

create policy "post-images select via post_images anon sfw"
  on storage.objects for select
  to anon
  using (
    bucket_id = 'post-images'
    and exists (
      select 1
      from public.post_images pi
      join public.posts p on p.id = pi.post_id
      where pi.storage_path = storage.objects.name
        and not coalesce(p.is_nsfw, false)
    )
  );

-- ---------------------------------------------------------------------------
-- Copy gallery onto reblog rows when snapshot matches chain root media
-- ---------------------------------------------------------------------------
create or replace function public.post_images_copy_for_reblog()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  root_id uuid;
  root_path text;
begin
  if new.reblog_of is null then
    return new;
  end if;
  if exists (select 1 from public.post_images where post_id = new.id) then
    return new;
  end if;
  root_id := new.original_post_id;
  if root_id is null or root_id = new.id then
    return new;
  end if;
  if not exists (select 1 from public.post_images where post_id = root_id) then
    return new;
  end if;

  select nullif(btrim(p.image_storage_path), '') into root_path
  from public.posts p
  where p.id = root_id;

  if new.image_storage_path is not null
     and new.image_storage_path not in (
       select pi.storage_path from public.post_images pi where pi.post_id = root_id
     )
     and (
       root_path is null
       or new.image_storage_path is distinct from root_path
     )
  then
    -- Reblog row carries media that is not the root gallery / legacy path (e.g. quote-only image).
    return new;
  end if;

  insert into public.post_images (id, post_id, storage_path, "position", created_at)
  select gen_random_uuid(), new.id, pi.storage_path, pi."position", now()
  from public.post_images pi
  where pi.post_id = root_id
  order by pi."position";

  return new;
end;
$$;

drop trigger if exists post_images_copy_for_reblog_trigger on public.posts;
create trigger post_images_copy_for_reblog_trigger
  after insert on public.posts
  for each row
  execute function public.post_images_copy_for_reblog();
