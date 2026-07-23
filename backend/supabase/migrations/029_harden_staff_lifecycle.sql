-- Stable staff/account identity and lifecycle invariants.
-- Staff history is archived through is_active; assigned staff must not be
-- physically deleted or changed into an incompatible role.

begin;

alter table public.staff_members
  add column if not exists auth_user_id uuid;

do $$
begin
  if exists (
    select 1
    from public.staff_members
    where phone is not null
      and char_length(btrim(phone)) > 0
      and phone !~ '^[0-9+().[:space:]-]+$'
  ) then
    raise exception 'staff_members contains a phone with invalid characters';
  end if;
end
$$;

update public.staff_members
set
  full_name = btrim(full_name),
  email = nullif(lower(btrim(email)), ''),
  phone = case
    when nullif(regexp_replace(phone, '[^0-9]', '', 'g'), '') is null then null
    when regexp_replace(phone, '[^0-9]', '', 'g') like '84%'
      then '0' || substring(
        regexp_replace(phone, '[^0-9]', '', 'g')
        from 3
      )
    else regexp_replace(phone, '[^0-9]', '', 'g')
  end;

do $$
begin
  if exists (
    select 1
    from public.staff_members
    where char_length(btrim(full_name)) not between 1 and 255
  ) then
    raise exception 'staff_members contains an invalid full_name';
  end if;

  if exists (
    select lower(btrim(email))
    from public.staff_members
    where email is not null
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'staff_members contains duplicate normalized emails';
  end if;

  if exists (
    select 1
    from public.staff_members
    where phone is not null
      and phone !~ '^0(3|5|7|8|9)[0-9]{8}$'
  ) then
    raise exception 'staff_members contains an invalid Vietnam mobile phone';
  end if;
end
$$;

alter table public.staff_members
  drop constraint if exists staff_members_full_name_length_check,
  drop constraint if exists staff_members_email_canonical_check,
  drop constraint if exists staff_members_phone_format_check;

alter table public.staff_members
  add constraint staff_members_full_name_length_check
    check (char_length(btrim(full_name)) between 1 and 255),
  add constraint staff_members_email_canonical_check
    check (
      email is null
      or (
        char_length(email) between 3 and 254
        and email = lower(btrim(email))
      )
    ),
  add constraint staff_members_phone_format_check
    check (phone is null or phone ~ '^0(3|5|7|8|9)[0-9]{8}$');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'staff_members_auth_user_id_fkey'
      and conrelid = 'public.staff_members'::regclass
  ) then
    alter table public.staff_members
      add constraint staff_members_auth_user_id_fkey
      foreign key (auth_user_id)
      references auth.users(id)
      on delete set null;
  end if;
end
$$;

with available_accounts as (
  select distinct on (lower(btrim(email)))
    id,
    lower(btrim(email)) as normalized_email
  from auth.users
  where email is not null
    and deleted_at is null
  order by lower(btrim(email)), id
)
update public.staff_members staff
set auth_user_id = account.id
from available_accounts account
where staff.auth_user_id is null
  and staff.email is not null
  and staff.email = account.normalized_email;

create unique index if not exists ux_staff_members_auth_user_id
  on public.staff_members (auth_user_id)
  where auth_user_id is not null;

create index if not exists idx_staff_members_active_roster
  on public.staff_members (staff_type, full_name, id)
  where is_active = true;

-- Repair a missing join row from the legacy single-teacher column before
-- validating lifecycle invariants. Invalid legacy assignments still fail the
-- preflight below instead of being silently rewritten.
insert into public.class_teachers (class_id, teacher_id)
select class_.id, class_.teacher_id
from public.classes class_
join public.staff_members staff on staff.id = class_.teacher_id
where class_.teacher_id is not null
  and staff.staff_type = 'TEACHER'
  and (not class_.is_active or staff.is_active)
on conflict (class_id, teacher_id) do nothing;

do $$
begin
  if exists (
    select 1
    from public.class_teachers link
    join public.staff_members staff on staff.id = link.teacher_id
    join public.classes class_ on class_.id = link.class_id
    where staff.staff_type <> 'TEACHER'
       or (class_.is_active and not staff.is_active)
  ) then
    raise exception 'class_teachers contains an invalid staff assignment';
  end if;

  if exists (
    select 1
    from public.classes class_
    join public.staff_members staff on staff.id = class_.teacher_id
    where staff.staff_type <> 'TEACHER'
       or (class_.is_active and not staff.is_active)
  ) then
    raise exception 'classes.teacher_id contains an invalid staff assignment';
  end if;
end
$$;

create or replace function public.enforce_staff_assignment_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  target_id uuid;
begin
  target_id := case when tg_op = 'DELETE' then old.id else new.id end;

  if tg_op = 'DELETE' then
    raise exception 'staff records must be archived instead of deleted';
  end if;

  if old.staff_type = 'TEACHER'
     and new.staff_type <> 'TEACHER'
     and (
       exists (
         select 1
         from public.class_teachers link
         where link.teacher_id = target_id
       )
       or exists (
         select 1
         from public.classes class_
         where class_.teacher_id = target_id
       )
     ) then
    raise exception 'assigned teacher cannot change staff type';
  end if;

  if old.is_active
     and not new.is_active
     and (
       exists (
         select 1
         from public.class_teachers link
         join public.classes class_ on class_.id = link.class_id
         where link.teacher_id = target_id
           and class_.is_active
       )
       or exists (
         select 1
         from public.classes class_
         where class_.teacher_id = target_id
           and class_.is_active
       )
     ) then
    raise exception 'teacher assigned to an active class cannot be deactivated';
  end if;

  return new;
end
$$;

drop trigger if exists staff_members_assignment_lifecycle
  on public.staff_members;
create trigger staff_members_assignment_lifecycle
before update of staff_type, is_active or delete
on public.staff_members
for each row execute function public.enforce_staff_assignment_lifecycle();

create or replace function public.validate_class_teacher_staff()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  teacher_type text;
  teacher_is_active boolean;
  class_is_active boolean;
begin
  -- Lock class first, then staff. Class mutations use the same order. A
  -- NO KEY UPDATE lock is required here: KEY SHARE alone does not conflict
  -- with an UPDATE of staff_type/is_active.
  select class_.is_active
  into class_is_active
  from public.classes class_
  where class_.id = new.class_id
  for no key update;

  select staff.staff_type, staff.is_active
  into teacher_type, teacher_is_active
  from public.staff_members staff
  where staff.id = new.teacher_id
  for no key update;

  if teacher_type is distinct from 'TEACHER' then
    raise exception 'class teacher must reference a teacher';
  end if;
  if class_is_active and not teacher_is_active then
    raise exception 'active class teacher must be active';
  end if;

  return new;
end
$$;

drop trigger if exists class_teachers_validate_staff
  on public.class_teachers;
create trigger class_teachers_validate_staff
before insert or update of class_id, teacher_id
on public.class_teachers
for each row execute function public.validate_class_teacher_staff();

create or replace function public.validate_legacy_class_teacher_staff()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  teacher_type text;
  teacher_is_active boolean;
begin
  if new.teacher_id is null then
    teacher_type := null;
    teacher_is_active := null;
  else
    select staff.staff_type, staff.is_active
    into teacher_type, teacher_is_active
    from public.staff_members staff
    where staff.id = new.teacher_id
    for no key update;

    if teacher_type is distinct from 'TEACHER' then
      raise exception 'classes.teacher_id must reference a teacher';
    end if;
    if new.is_active and not teacher_is_active then
      raise exception 'active class teacher must be active';
    end if;
  end if;

  if new.is_active then
    -- Lock every junction teacher before validation so a concurrent staff
    -- deactivation/type change cannot commit between this check and class
    -- activation.
    perform staff.id
    from public.class_teachers link
    join public.staff_members staff on staff.id = link.teacher_id
    where link.class_id = new.id
    for no key update of staff;

    if exists (
      select 1
      from public.class_teachers link
      join public.staff_members staff on staff.id = link.teacher_id
      where link.class_id = new.id
        and (
          staff.staff_type <> 'TEACHER'
          or not staff.is_active
        )
    ) then
      raise exception 'active class contains an invalid teacher assignment';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists classes_validate_legacy_teacher
  on public.classes;
create trigger classes_validate_legacy_teacher
before insert or update of teacher_id, is_active
on public.classes
for each row execute function public.validate_legacy_class_teacher_staff();

revoke all on function public.enforce_staff_assignment_lifecycle()
  from public, anon, authenticated;
revoke all on function public.validate_class_teacher_staff()
  from public, anon, authenticated;
revoke all on function public.validate_legacy_class_teacher_staff()
  from public, anon, authenticated;

commit;
