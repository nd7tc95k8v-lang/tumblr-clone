create table if not exists public.action_rate_limits (
  user_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  window_started_at timestamptz not null default now(),
  action_count integer not null default 0,
  primary key (user_id, action)
);
