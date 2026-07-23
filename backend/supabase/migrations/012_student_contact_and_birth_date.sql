-- Student contact fields and precise birth dates.
-- Demo names, phone numbers and hand-picked birthdays belong exclusively to
-- supabase/seeds and must never overwrite staging/production student data.

alter table public.students
  rename column parent_zalo_name to parent_zalo;

alter table public.students
  add column student_zalo text,
  add column student_phone text,
  add column birth_date date;

update public.students
set birth_date = make_date(birth_year, 1, 1)
where birth_year is not null;

alter table public.students
  drop column birth_year;
