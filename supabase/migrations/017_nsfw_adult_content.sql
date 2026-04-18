-- NSFW post flags, profile labeling vs default-post NSFW, adult access (6-month renewal), append-only verification log.
-- Thread model unchanged: original_post_id, reblog_of, reblog triggers stay as-is.

-- ---------------------------------------------------------------------------
-- A) profiles: labeling (separate from default post flag) + adult access snapshot
--    Snapshot columns are current state only; full history lives in age_verification_events.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists profile_is_nsfw boolean not null default false,
  add column if not exists default_posts_nsfw boolean not null default false,
  add column if not exists adult_content_status text not null default 'unknown',
  add column if not exists adult_content_access_granted_at timestamptz,
  add column if not exists adult_content_access_expires_at timestamptz,
  add column if not exists adult_content_access_method text;

comment on column public.profiles.profile_is_nsfw is
  'Public-facing “this blog is mature” label; does NOT force existing posts NSFW (UX vs default_posts_nsfw).';
comment on column public.profiles.default_posts_nsfw is
  'When true, new posts by this user are forced NSFW on insert (trigger); reblogs still inherit parent NSFW.';

-- ---------------------------------------------------------------------------
-- B) posts: immutable NSFW + optional audit reason
-- ---------------------------------------------------------------------------
alter table public.posts
  add column if not exists is_nsfw boolean not null default false,
  add column if not exists nsfw_source text;

comment on column public.posts.is_nsfw is
  'Once true, stays true (enforced in trigger). Inherited from parent reblog or profile default or author flag.';
comment on column public.posts.nsfw_source is
  'Debug/audit hint: parent_chain | profile_default_posts_nsfw | author | none';

create index if not exists posts_is_nsfw_idx on public.posts (is_nsfw) where is_nsfw;

-- ---------------------------------------------------------------------------
-- C) age_verification_events — append-only audit log (each attestation attempt).
--    method values: self_attest_v1 (today); reserve vendor_verified_v1, id_document_v1, etc.
-- ---------------------------------------------------------------------------
create table if not exists public.age_verification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  method text not null,
  result text not null,
  is_adult_asserted boolean not null,
  effective_until timestamptz,
  policy_version text not null,
  prompt_text text not null,
  ip_hash text,
  user_agent_hash text,
  country_code text,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.age_verification_events is
  'Append-only legal/audit log of adult-access attempts. Not a live permission store (see profiles adult_* snapshot).';

create index if not exists age_verification_events_user_created_idx
  on public.age_verification_events (user_id, created_at desc);

alter table public.age_verification_events enable row level security;

-- No direct inserts from clients; RPC uses security definer.
drop policy if exists "age_verification_select_own" on public.age_verification_events;

create policy "age_verification_select_own"
  on public.age_verification_events for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- D) adult_content_access_ok — live gate for RLS (not the audit log).
-- ---------------------------------------------------------------------------
create or replace function public.adult_content_access_ok(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null
    and exists (
      select 1
      from public.profiles pr
      where pr.id = p_user
        and pr.adult_content_status = 'granted'
        and pr.adult_content_access_expires_at is not null
        and pr.adult_content_access_expires_at > now()
    );
$$;

comment on function public.adult_content_access_ok(uuid) is
  'True when profile snapshot shows an unexpired adult grant (renew via record_adult_content_self_attestation).';

revoke all on function public.adult_content_access_ok(uuid) from public;
grant execute on function public.adult_content_access_ok(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- E) Block clients from forging adult-access snapshot columns on profiles.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_guard_adult_access_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.adult_content_status is distinct from old.adult_content_status
    or new.adult_content_access_granted_at is distinct from old.adult_content_access_granted_at
    or new.adult_content_access_expires_at is distinct from old.adult_content_access_expires_at
    or new.adult_content_access_method is distinct from old.adult_content_access_method
  then
    if current_setting('app.record_adult_access_event', true) is distinct from 'on' then
      new.adult_content_status := old.adult_content_status;
      new.adult_content_access_granted_at := old.adult_content_access_granted_at;
      new.adult_content_access_expires_at := old.adult_content_access_expires_at;
      new.adult_content_access_method := old.adult_content_access_method;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_adult_access_snapshot_trigger on public.profiles;
create trigger profiles_guard_adult_access_snapshot_trigger
  before update on public.profiles
  for each row
  execute function public.profiles_guard_adult_access_snapshot();

-- ---------------------------------------------------------------------------
-- F) posts: NSFW inheritance on insert + immutability on update (DB authoritative).
-- ---------------------------------------------------------------------------
create or replace function public.posts_enforce_nsfw()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_nsfw boolean := false;
  v_default boolean := false;
  v_author_flag boolean;
begin
  if tg_op = 'INSERT' then
    v_author_flag := coalesce(new.is_nsfw, false);

    if new.reblog_of is not null then
      select coalesce(p.is_nsfw, false)
      into v_parent_nsfw
      from public.posts p
      where p.id = new.reblog_of;
    end if;

    select coalesce(pr.default_posts_nsfw, false)
    into v_default
    from public.profiles pr
    where pr.id = new.user_id;

    new.is_nsfw := v_parent_nsfw or v_default or v_author_flag;

    if v_parent_nsfw then
      new.nsfw_source := 'parent_chain';
    elsif v_default and not v_author_flag and not v_parent_nsfw then
      new.nsfw_source := 'profile_default_posts_nsfw';
    elsif v_author_flag then
      new.nsfw_source := coalesce(nullif(btrim(coalesce(new.nsfw_source, '')), ''), 'author');
    else
      new.nsfw_source := coalesce(nullif(btrim(coalesce(new.nsfw_source, '')), ''), 'none');
    end if;

    return new;
  elsif tg_op = 'UPDATE' then
    if coalesce(old.is_nsfw, false) then
      new.is_nsfw := true;
      if new.nsfw_source is null or btrim(new.nsfw_source) = '' then
        new.nsfw_source := old.nsfw_source;
      end if;
    end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_enforce_nsfw_trigger on public.posts;
create trigger posts_enforce_nsfw_trigger
  before insert or update on public.posts
  for each row
  execute function public.posts_enforce_nsfw();

-- ---------------------------------------------------------------------------
-- G) RLS: hide NSFW posts unless viewer has valid adult access (or post is SFW).
-- ---------------------------------------------------------------------------
drop policy if exists "Anonymous users can read posts" on public.posts;
drop policy if exists "Authenticated users can read posts" on public.posts;

drop policy if exists "posts_select_respect_nsfw_anon" on public.posts;

create policy "posts_select_respect_nsfw_anon"
  on public.posts for select
  to anon
  using (
    not coalesce(posts.is_nsfw, false)
    or public.adult_content_access_ok(auth.uid())
  );

drop policy if exists "posts_select_respect_nsfw_authenticated" on public.posts;

create policy "posts_select_respect_nsfw_authenticated"
  on public.posts for select
  to authenticated
  using (
    not coalesce(posts.is_nsfw, false)
    or public.adult_content_access_ok(auth.uid())
  );

-- ---------------------------------------------------------------------------
-- H) RPC: self-attestation + event row every call; grants 6 months when p_is_adult true.
-- ---------------------------------------------------------------------------
create or replace function public.record_adult_content_self_attestation(
  p_is_adult boolean,
  p_policy_version text,
  p_prompt_text text,
  p_ip_hash text default null,
  p_user_agent_hash text default null,
  p_country_code text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_until timestamptz;
  v_result text;
begin
  if uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_policy_version is null or btrim(p_policy_version) = '' then
    return json_build_object('ok', false, 'error', 'policy_version_required');
  end if;

  if p_prompt_text is null or btrim(p_prompt_text) = '' then
    return json_build_object('ok', false, 'error', 'prompt_text_required');
  end if;

  v_until := case when p_is_adult then now() + interval '6 months' else null end;
  v_result := case when p_is_adult then 'granted' else 'declined' end;

  insert into public.age_verification_events (
    user_id,
    method,
    result,
    is_adult_asserted,
    effective_until,
    policy_version,
    prompt_text,
    ip_hash,
    user_agent_hash,
    country_code,
    metadata
  )
  values (
    uid,
    'self_attest_v1',
    v_result,
    p_is_adult,
    v_until,
    p_policy_version,
    p_prompt_text,
    p_ip_hash,
    p_user_agent_hash,
    p_country_code,
    coalesce(p_metadata, '{}'::jsonb)
  );

  if p_is_adult then
    perform set_config('app.record_adult_access_event', 'on', true);
    update public.profiles
    set
      adult_content_status = 'granted',
      adult_content_access_granted_at = now(),
      adult_content_access_expires_at = v_until,
      adult_content_access_method = 'self_attest_v1'
    where id = uid;
    perform set_config('app.record_adult_access_event', '', true);
  end if;

  return json_build_object(
    'ok', true,
    'granted', p_is_adult,
    'expires_at', v_until
  );
end;
$$;

revoke all on function public.record_adult_content_self_attestation(boolean, text, text, text, text, text, jsonb) from public;
grant execute on function public.record_adult_content_self_attestation(boolean, text, text, text, text, text, jsonb) to authenticated;
