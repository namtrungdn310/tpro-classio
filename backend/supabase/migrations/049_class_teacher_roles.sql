-- Allow ASSISTANT staff to be linked through the class_teachers junction so
-- a class can carry both teachers and teaching assistants. The legacy
-- classes.teacher_id column remains teacher-only (validate_legacy_class_teacher_staff
-- is left untouched).

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

  if teacher_type not in ('TEACHER', 'ASSISTANT') then
    raise exception 'class member must be a teacher or assistant';
  end if;
  if class_is_active and not teacher_is_active then
    raise exception 'active class member must be active';
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
