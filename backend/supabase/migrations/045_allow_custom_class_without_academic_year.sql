-- Custom classes may be free-form and do not always belong to a school year.
-- Keep school-year identity mandatory for GENERAL/SPECIALIZED while allowing
-- CUSTOM to explicitly choose "Không" in the form.

begin;

alter table public.classes
  drop constraint if exists classes_category_shape_check;

alter table public.classes
  add constraint classes_category_shape_check
  check (
    (class_category is null
      and grade_mode is null
      and identity_scheme in ('LEGACY', 'ACADEMIC_YEAR', 'INTAKE'))
    or (class_category = 'GENERAL'
      and identity_scheme = 'ACADEMIC_YEAR'
      and grade_mode = 'GRADE'
      and grade_level between 1 and 12
      and academic_year_start between 2000 and 2200)
    or (class_category = 'SPECIALIZED'
      and identity_scheme = 'ACADEMIC_YEAR'
      and academic_year_start between 2000 and 2200
      and (
        (grade_mode = 'GRADE' and grade_level between 1 and 12)
        or (grade_mode = 'NONE' and grade_level is null)
      ))
    or (class_category = 'CUSTOM'
      and identity_scheme = 'ACADEMIC_YEAR'
      and (
        academic_year_start is null
        or academic_year_start between 2000 and 2200
      )
      and (
        (grade_mode = 'GRADE' and grade_level between 1 and 12)
        or (grade_mode = 'NONE' and grade_level is null)
      ))
    or (class_category = 'IELTS'
      and identity_scheme = 'INTAKE'
      and grade_mode = 'NONE'
      and grade_level is null
      and academic_year_start is null)
  ) not valid;

drop index if exists public.classes_academic_identity_unique_idx;
create unique index classes_academic_identity_unique_idx
  on public.classes (
    class_category,
    lower(btrim(name)),
    coalesce(grade_level, 0),
    coalesce(academic_year_start, 0)
  )
  where identity_scheme = 'ACADEMIC_YEAR' and cancelled_at is null;

commit;
