-- Add unique account usernames for settings/profile display.

alter table profiles
add column if not exists username text;

with candidates as (
  select
    profiles.id,
    coalesce(
      nullif(left(regexp_replace(coalesce(profiles.full_name, split_part(auth.users.email, '@', 1)), '[^A-Za-z0-9]', '', 'g'), 20), ''),
      'user' || left(replace(profiles.id::text, '-', ''), 8)
    ) as base_username
  from profiles
  join auth.users on auth.users.id = profiles.id
  where profiles.username is null
),
numbered as (
  select
    id,
    case
      when length(base_username) < 3 then 'user' || left(replace(id::text, '-', ''), 8)
      else base_username
    end as base_username,
    row_number() over (
      partition by lower(case when length(base_username) < 3 then 'user' || left(replace(id::text, '-', ''), 8) else base_username end)
      order by id
    ) as duplicate_index
  from candidates
)
update profiles
set username = case
  when numbered.duplicate_index = 1 then left(numbered.base_username, 20)
  else left(numbered.base_username, 20 - length(numbered.duplicate_index::text)) || numbered.duplicate_index::text
end
from numbered
where profiles.id = numbered.id;

update profiles
set full_name = username
where full_name is null;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_profiles_username_unique'
  ) then
    create unique index idx_profiles_username_unique
    on profiles (lower(username))
    where username is not null;
  end if;
end $$;
