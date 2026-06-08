-- Queue scheduler worker RPCs (service_role only). Manual client RPCs remain in 049.

-- Must stay in sync with QUEUE_PUBLISH_CLEANUP_FAILED_MESSAGE in publish-queue-item.ts
-- 'Post was published, but the queue item could not be removed. Delete this queue item before publishing again.'

create or replace function public.queue_scheduler_assert_service_role()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.queue_scheduler_assert_service_role() from public;

-- ---------------------------------------------------------------------------
-- claim_queue_item_for_publish_worker
-- ---------------------------------------------------------------------------
create or replace function public.claim_queue_item_for_publish_worker(
  p_user_id uuid,
  p_queue_id uuid
)
returns setof public.post_queue
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.queue_scheduler_assert_service_role();

  if p_user_id is null or p_queue_id is null then
    return;
  end if;

  return query
  update public.post_queue q
  set
    status = 'publishing',
    last_error = null,
    updated_at = now()
  where q.id = p_queue_id
    and q.user_id = p_user_id
    and q.status in ('queued', 'failed')
  returning q.*;
end;
$$;

comment on function public.claim_queue_item_for_publish_worker(uuid, uuid) is
  'Scheduler-only atomic claim for explicit user_id. Same semantics as claim_queue_item_for_publish.';

revoke all on function public.claim_queue_item_for_publish_worker(uuid, uuid) from public;
grant execute on function public.claim_queue_item_for_publish_worker(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- reset_stale_queue_publishing_worker
-- ---------------------------------------------------------------------------
create or replace function public.reset_stale_queue_publishing_worker(p_older_than_minutes int default 15)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_minutes int;
  v_count int;
begin
  perform public.queue_scheduler_assert_service_role();

  v_minutes := coalesce(p_older_than_minutes, 15);
  if v_minutes < 1 then
    v_minutes := 15;
  end if;

  update public.post_queue q
  set
    status = 'failed',
    last_error = 'Publish timed out. Please retry.',
    updated_at = now()
  where q.status = 'publishing'
    and q.updated_at < now() - make_interval(mins => v_minutes);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.reset_stale_queue_publishing_worker(int) is
  'Scheduler-only: mark stale publishing rows failed for all users.';

revoke all on function public.reset_stale_queue_publishing_worker(int) from public;
grant execute on function public.reset_stale_queue_publishing_worker(int) to service_role;

-- ---------------------------------------------------------------------------
-- select_due_queue_users
-- ---------------------------------------------------------------------------
create or replace function public.select_due_queue_users(p_limit int default 50)
returns table (
  user_id uuid,
  queue_interval_minutes integer,
  queue_next_run_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int;
begin
  perform public.queue_scheduler_assert_service_role();

  v_limit := coalesce(p_limit, 50);
  if v_limit < 1 then
    v_limit := 1;
  elsif v_limit > 500 then
    v_limit := 500;
  end if;

  return query
  select
    p.id as user_id,
    p.queue_interval_minutes,
    p.queue_next_run_at
  from public.profiles p
  where p.queue_enabled = true
    and (
      p.queue_next_run_at is null
      or p.queue_next_run_at <= now()
    )
  order by p.queue_next_run_at nulls first, p.id
  limit v_limit;
end;
$$;

comment on function public.select_due_queue_users(int) is
  'Scheduler-only: users with queue_enabled due for a publish tick.';

revoke all on function public.select_due_queue_users(int) from public;
grant execute on function public.select_due_queue_users(int) to service_role;

-- ---------------------------------------------------------------------------
-- select_next_schedulable_queue_item
-- ---------------------------------------------------------------------------
create or replace function public.select_next_schedulable_queue_item(p_user_id uuid)
returns setof public.post_queue
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.queue_scheduler_assert_service_role();

  if p_user_id is null then
    return;
  end if;

  return query
  select q.*
  from public.post_queue q
  where q.user_id = p_user_id
    and (
      q.status = 'queued'
      or (
        q.status = 'failed'
        and coalesce(q.last_error, '') is distinct from
          'Post was published, but the queue item could not be removed. Delete this queue item before publishing again.'
      )
    )
  order by q.queue_position asc, q.created_at asc
  limit 1;
end;
$$;

comment on function public.select_next_schedulable_queue_item(uuid) is
  'Scheduler-only: lowest-position claimable queue row; skips cleanup-failure rows.';

revoke all on function public.select_next_schedulable_queue_item(uuid) from public;
grant execute on function public.select_next_schedulable_queue_item(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- advance_queue_scheduler_next_run
-- ---------------------------------------------------------------------------
create or replace function public.advance_queue_scheduler_next_run(p_user_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_next timestamptz;
  v_interval int;
begin
  perform public.queue_scheduler_assert_service_role();

  if p_user_id is null then
    return null;
  end if;

  select p.queue_interval_minutes into v_interval
  from public.profiles p
  where p.id = p_user_id
    and p.queue_enabled = true;

  if v_interval is null then
    return null;
  end if;

  update public.profiles p
  set queue_next_run_at = now() + make_interval(mins => v_interval)
  where p.id = p_user_id
    and p.queue_enabled = true
  returning p.queue_next_run_at into v_next;

  return v_next;
end;
$$;

comment on function public.advance_queue_scheduler_next_run(uuid) is
  'Scheduler-only: bump queue_next_run_at by the user queue_interval_minutes.';

revoke all on function public.advance_queue_scheduler_next_run(uuid) from public;
grant execute on function public.advance_queue_scheduler_next_run(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- initialize_queue_scheduler_next_run
-- ---------------------------------------------------------------------------
create or replace function public.initialize_queue_scheduler_next_run(p_user_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_next timestamptz;
begin
  perform public.queue_scheduler_assert_service_role();

  if p_user_id is null then
    return null;
  end if;

  update public.profiles p
  set queue_next_run_at = now()
  where p.id = p_user_id
    and p.queue_enabled = true
    and p.queue_next_run_at is null
  returning p.queue_next_run_at into v_next;

  return v_next;
end;
$$;

comment on function public.initialize_queue_scheduler_next_run(uuid) is
  'Scheduler-only: set queue_next_run_at to now() when enabled and unset.';

revoke all on function public.initialize_queue_scheduler_next_run(uuid) from public;
grant execute on function public.initialize_queue_scheduler_next_run(uuid) to service_role;
