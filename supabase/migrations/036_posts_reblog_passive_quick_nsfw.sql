-- Quick (one-tap) reblog vs reblog-from-editor: passive quick reblogs of SFW parents must not
-- inherit profiles.default_posts_nsfw. Editor/modal reblogs keep the previous default + author flag OR.
-- NSFW parent rows still force mature on all child reblogs regardless of this flag.

alter table public.posts
  add column if not exists reblog_passive_quick boolean not null default false;

comment on column public.posts.reblog_passive_quick is
  'Insert-time only: true for one-tap quick reblog (no editor). When true and immediate parent is not NSFW, default_posts_nsfw is not applied. Parent NSFW still forces mature via trigger.';

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

    if new.reblog_of is not null and v_parent_nsfw then
      new.is_nsfw := true;
      new.nsfw_source := 'parent_chain';
    elsif new.reblog_of is not null and coalesce(new.reblog_passive_quick, false) then
      -- Passive quick reblog: SFW parents only reach here for NSFW coercion; parent_chain handled above.
      new.is_nsfw := v_author_flag;
      if new.is_nsfw then
        new.nsfw_source := coalesce(nullif(btrim(coalesce(new.nsfw_source, '')), ''), 'author');
      else
        new.nsfw_source := coalesce(nullif(btrim(coalesce(new.nsfw_source, '')), ''), 'none');
      end if;
    else
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
