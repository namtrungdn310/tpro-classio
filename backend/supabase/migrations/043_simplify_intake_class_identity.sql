-- Intake classes now use the entered class name and opening month only.
-- This is forward-only for databases where 042 has already been applied.

begin;

alter table public.classes
  drop constraint if exists classes_identity_shape_check;

update public.classes
set program_name = null
where identity_scheme = 'INTAKE';

alter table public.classes
  add constraint classes_identity_shape_check
  check (
    (identity_scheme = 'LEGACY'
      and program_name is null
      and grade_level is null
      and education_level is null
      and academic_year_start is null)
    or (identity_scheme = 'ACADEMIC_YEAR'
      and grade_level between 1 and 12
      and education_level in ('PRIMARY', 'MIDDLE', 'HIGH')
      and academic_year_start between 2000 and 2200
      and program_name is null)
    or (identity_scheme = 'INTAKE'
      and program_name is null
      and grade_level is null
      and education_level is null
      and academic_year_start is null)
  ) not valid;

drop index if exists public.classes_intake_identity_unique_idx;
create unique index classes_intake_identity_unique_idx
  on public.classes (lower(btrim(name)), intake_year_month)
  where identity_scheme = 'INTAKE';

commit;
