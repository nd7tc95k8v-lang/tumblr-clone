-- Public username chosen in-app; nullable until onboarding. Uniqueness is case-insensitive.

alter table public.profiles alter column username drop not null;

alter table public.profiles drop constraint if exists profiles_username_unique;

drop index if exists profiles_username_idx;

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username))
  where username is not null;

-- Existing rows that look like emails must pick a new public username.
update public.profiles
set username = null
where username is not null
  and position('@' in username) > 0;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;
