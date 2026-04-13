-- Human check (24h) + rate limits enforced in RLS. Client checks are UX only.

alter table public.profiles
  add column if not exists last_human_check_at timestamptz;

-- Block clients from forging last_human_check_at; only mark_human_check_passed may change it.
create or replace function public.profiles_guard_last_human_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.last_human_check_at is distinct from old.last_human_check_at then
    if current_setting('app.mark_human_check_session', true) is distinct from 'on' then
      new.last_human_check_at := old.last_human_check_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_last_human_check_trigger on public.profiles;
create trigger profiles_guard_last_human_check_trigger
  before update on public.profiles
  for each row
  execute function public.profiles_guard_last_human_check();

-- Cannot change return type with CREATE OR REPLACE (e.g. void -> json) if a prior version exists.
drop function if exists public.mark_human_check_passed();

-- Called from app after user passes the local challenge (RPC still rate-limited by row update rules).
create function public.mark_human_check_passed()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  perform set_config('app.mark_human_check_session', 'on', true);

  update public.profiles
  set last_human_check_at = now()
  where id = auth.uid()
    and (
      last_human_check_at is null
      or last_human_check_at < now() - interval '24 hours'
    );

  get diagnostics n = row_count;
  perform set_config('app.mark_human_check_session', '', true);

  if n > 0 then
    return json_build_object('ok', true, 'updated', true);
  end if;

  if exists (
    select 1 from public.profiles
    where id = auth.uid()
      and last_human_check_at is not null
      and last_human_check_at > now() - interval '24 hours'
  ) then
    return json_build_object('ok', true, 'updated', false);
  end if;

  return json_build_object('ok', false, 'error', 'profile_not_found');
end;
$$;

revoke all on function public.mark_human_check_passed() from public;
grant execute on function public.mark_human_check_passed() to authenticated;

create or replace function public.human_check_fresh(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user
      and p.last_human_check_at is not null
      and p.last_human_check_at > now() - interval '24 hours'
  );
$$;

revoke all on function public.human_check_fresh(uuid) from public;

create or replace function public.post_rate_ok(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select count(*)::int < 10
      from public.posts
      where user_id = p_user
        and created_at > now() - interval '1 minute'
    ),
    true
  );
$$;

revoke all on function public.post_rate_ok(uuid) from public;

create or replace function public.follow_insert_rate_ok(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select count(*)::int < 20
      from public.follows
      where follower_id = p_user
        and created_at > now() - interval '1 minute'
    ),
    true
  );
$$;

revoke all on function public.follow_insert_rate_ok(uuid) from public;

-- Lightweight status for the client (convenience; RLS is authoritative).
create or replace function public.get_action_guard_status()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  last_check timestamptz;
  human_ok boolean;
  posts_1m int;
  follows_ins_1m int;
begin
  if uid is null then
    return json_build_object(
      'authenticated', false,
      'human_check_ok', false,
      'post_rate_ok', false,
      'follow_insert_rate_ok', false
    );
  end if;

  select last_human_check_at into last_check from public.profiles where id = uid;
  human_ok := last_check is not null and last_check > now() - interval '24 hours';

  select count(*)::int into posts_1m
  from public.posts
  where user_id = uid and created_at > now() - interval '1 minute';

  select count(*)::int into follows_ins_1m
  from public.follows
  where follower_id = uid and created_at > now() - interval '1 minute';

  return json_build_object(
    'authenticated', true,
    'human_check_ok', human_ok,
    'post_rate_ok', posts_1m < 10,
    'follow_insert_rate_ok', follows_ins_1m < 20
  );
end;
$$;

revoke all on function public.get_action_guard_status() from public;
grant execute on function public.get_action_guard_status() to authenticated;

drop policy if exists "Users insert own posts" on public.posts;

create policy "posts_insert_own_guarded"
  on public.posts for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and public.human_check_fresh(auth.uid())
    and public.post_rate_ok(auth.uid())
  );

drop policy if exists "follows_insert_own" on public.follows;

create policy "follows_insert_own"
  on public.follows for insert
  to authenticated
  with check (
    follower_id = auth.uid()
    and follower_id <> following_id
    and public.human_check_fresh(auth.uid())
    and public.follow_insert_rate_ok(auth.uid())
  );

drop policy if exists "follows_delete_own" on public.follows;

create policy "follows_delete_own"
  on public.follows for delete
  to authenticated
  using (
    follower_id = auth.uid()
    and public.human_check_fresh(auth.uid())
  );
