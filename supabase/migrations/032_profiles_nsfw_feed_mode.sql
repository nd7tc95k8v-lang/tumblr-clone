-- Viewer preference for how mature (NSFW) posts appear in discovery feeds (home/explore/search).
-- Does not affect posts.is_nsfw; does not change profile or tag post listings.

alter table public.profiles
  add column if not exists nsfw_feed_mode text;

update public.profiles
set nsfw_feed_mode = 'warn'
where nsfw_feed_mode is null
   or btrim(nsfw_feed_mode) not in ('show', 'warn', 'hide');

alter table public.profiles
  alter column nsfw_feed_mode set default 'warn';

alter table public.profiles
  alter column nsfw_feed_mode set not null;

alter table public.profiles
  drop constraint if exists profiles_nsfw_feed_mode_check;

alter table public.profiles
  add constraint profiles_nsfw_feed_mode_check
  check (nsfw_feed_mode in ('show', 'warn', 'hide'));

comment on column public.profiles.nsfw_feed_mode is
  'Feed NSFW policy for this viewer: show (no gate), warn (tap-to-view in home/explore/search), hide (omit NSFW rows from those feeds).';
