-- Follow-up to migration 049: the legacy classes.teacher_id column stays
-- teacher-only, but the class_teachers junction may now hold assistants. The
-- legacy validation trigger that runs on teacher_id updates must therefore no
-- longer require every junction member to be a TEACHER — only active.

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
    -- Lock every junction member before validation so a concurrent staff
    -- deactivation/type change cannot commit between this check and class
    -- activation. Teachers and assistants are both allowed in the junction.
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
        and not staff.is_active
    ) then
      raise exception 'active class contains an inactive teacher or assistant';
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
