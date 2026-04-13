-- One profile per auth user; posts.user_id references profiles.id (same value as auth.uid()).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  constraint profiles_username_unique unique (username)
);

create index if not exists profiles_username_idx on public.profiles (username);

-- Existing users (run in Supabase SQL editor / migration as a privileged role).
insert into public.profiles (id, username)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'username'), ''),
    split_part(coalesce(u.email, 'user@local'), '@', 1)
  )
  || '_'
  || left(replace(u.id::text, '-', ''), 8)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'username'), ''),
      split_part(coalesce(new.email, 'user@local'), '@', 1)
    )
    || '_'
    || left(replace(new.id::text, '-', ''), 8)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

alter table public.posts
  drop constraint if exists posts_user_id_fkey;

alter table public.posts
  add constraint posts_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

alter table public.profiles enable row level security;

create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);
