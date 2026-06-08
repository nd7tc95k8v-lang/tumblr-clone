-- Atomic queue publish claim + stale publishing recovery (manual publish + future scheduler).

-- ---------------------------------------------------------------------------
-- claim_queue_item_for_publish: one winner per queue row
-- ---------------------------------------------------------------------------
create or replace function public.claim_queue_item_for_publish(p_queue_id uuid)
returns setof public.post_queue
language sql
volatile
security invoker
set search_path = public
as $$
  update public.post_queue q
  set
    status = 'publishing',
    last_error = null,
    updated_at = now()
  where q.id = p_queue_id
    and q.user_id = auth.uid()
    and q.status in ('queued', 'failed')
  returning q.*;
$$;

comment on function public.claim_queue_item_for_publish(uuid) is
  'Author-only atomic claim: queued/failed → publishing. Returns the row or no rows when not claimable.';

revoke all on function public.claim_queue_item_for_publish(uuid) from public;
grant execute on function public.claim_queue_item_for_publish(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reset_stale_queue_publishing: recover stuck publishing rows for current user
-- ---------------------------------------------------------------------------
create or replace function public.reset_stale_queue_publishing(p_older_than_minutes int default 15)
returns integer
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_minutes int;
  v_count int;
begin
  v_minutes := coalesce(p_older_than_minutes, 15);
  if v_minutes < 1 then
    v_minutes := 15;
  end if;

  update public.post_queue q
  set
    status = 'failed',
    last_error = 'Publish timed out. Please retry.',
    updated_at = now()
  where q.user_id = auth.uid()
    and q.status = 'publishing'
    and q.updated_at < now() - make_interval(mins => v_minutes);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.reset_stale_queue_publishing(int) is
  'Author-only: mark stale publishing rows failed so manual retry is possible. User-scoped; worker may add service-role variant later.';

revoke all on function public.reset_stale_queue_publishing(int) from public;
grant execute on function public.reset_stale_queue_publishing(int) to authenticated;
