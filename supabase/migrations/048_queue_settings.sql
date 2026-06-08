-- User-level queue scheduler preferences (worker reads these in a later phase).

alter table public.profiles
  add column if not exists queue_enabled boolean not null default false;

alter table public.profiles
  add column if not exists queue_interval_minutes integer not null default 240;

alter table public.profiles
  add column if not exists queue_next_run_at timestamptz null;

alter table public.profiles
  drop constraint if exists profiles_queue_interval_minutes_check;

alter table public.profiles
  add constraint profiles_queue_interval_minutes_check
  check (queue_interval_minutes in (60, 120, 240, 480, 1440));

comment on column public.profiles.queue_enabled is
  'When true, a future scheduler may publish queued posts on queue_interval_minutes.';

comment on column public.profiles.queue_interval_minutes is
  'Minutes between scheduled queue publishes: 60, 120, 240, 480, or 1440.';

comment on column public.profiles.queue_next_run_at is
  'Next scheduled queue publish time; set/cleared by the future worker, not manual publish.';
