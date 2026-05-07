-- Reblogs must not inherit profiles.default_posts_nsfw (original posts still do).
-- Parent NSFW still forces child NSFW; explicit is_nsfw on insert (editor “mature”) still honored for SFW parents.
-- posts.reblog_passive_quick remains on the table for compatibility but is no longer consulted here.

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

    if new.reblog_of is not null then
      if v_parent_nsfw then
        new.is_nsfw := true;
        new.nsfw_source := 'parent_chain';
      else
        new.is_nsfw := v_author_flag;
        if new.is_nsfw then
          new.nsfw_source := coalesce(nullif(btrim(coalesce(new.nsfw_source, '')), ''), 'author');
        else
          new.nsfw_source := coalesce(nullif(btrim(coalesce(new.nsfw_source, '')), ''), 'none');
        end if;
      end if;
    else
      new.is_nsfw := v_default or v_author_flag;
      if v_default and not v_author_flag then
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
