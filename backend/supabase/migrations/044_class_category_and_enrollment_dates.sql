-- Canonical class categories and per-class enrollment date integrity.
-- Forward-only: apply after 042 and 043. Never edit/re-run 041.

begin;

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'class_category' and typnamespace = 'public'::regnamespace
  ) then
    create type public.class_category as enum (
      'GENERAL', 'SPECIALIZED', 'IELTS', 'CUSTOM'
    );
  end if;
  if not exists (
    select 1 from pg_type
    where typname = 'class_grade_mode' and typnamespace = 'public'::regnamespace
  ) then
    create type public.class_grade_mode as enum ('GRADE', 'NONE');
  end if;
end
$$;

alter table public.classes
  add column if not exists class_category public.class_category,
  add column if not exists grade_mode public.class_grade_mode;

-- These mappings come from the previous explicit UI choices. No class name is
-- parsed. Rows that cannot be classified safely remain LEGACY/unclassified.
update public.classes
set class_category = 'GENERAL', grade_mode = 'GRADE'
where identity_scheme = 'ACADEMIC_YEAR'
  and grade_level between 1 and 12
  and class_category is null;

-- The previous INTAKE option combined IELTS and exam-preparation classes, so
-- those rows cannot be classified safely without an explicit administrator
-- decision. Keep them compatible but unclassified instead of guessing IELTS.

alter table public.classes
  drop constraint if exists classes_identity_shape_check,
  drop constraint if exists classes_education_level_matches_grade_check,
  drop constraint if exists classes_lifecycle_dates_check,
  add constraint classes_lifecycle_dates_check
  check (
    identity_scheme = 'LEGACY'
    or (start_date is not null and end_date is not null and end_date > start_date)
  ) not valid,
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
    or (class_category in ('SPECIALIZED', 'CUSTOM')
      and identity_scheme = 'ACADEMIC_YEAR'
      and academic_year_start between 2000 and 2200
      and (
        (grade_mode = 'GRADE' and grade_level between 1 and 12)
        or (grade_mode = 'NONE' and grade_level is null)
      ))
    or (class_category = 'IELTS'
      and identity_scheme = 'INTAKE'
      and grade_mode = 'NONE'
      and grade_level is null
      and academic_year_start is null)
  ) not valid,
  add constraint classes_derived_legacy_metadata_check
  check (
    identity_scheme = 'LEGACY'
    or (program_name is null and (
      grade_level is null
      or education_level = case
        when grade_level between 1 and 5 then 'PRIMARY'
        when grade_level between 6 and 9 then 'MIDDLE'
        when grade_level between 10 and 12 then 'HIGH'
      end
    ))
  ) not valid,
  add constraint classes_weekly_schedule_limit_check
  check (
    schedule is null
    or (
      jsonb_typeof(schedule) = 'object'
      and (
        not (schedule ? 'slots')
        or (
          jsonb_typeof(schedule -> 'slots') = 'array'
          and jsonb_array_length(schedule -> 'slots') <= 4
        )
      )
    )
  ) not valid;

drop index if exists public.classes_academic_identity_unique_idx;
drop index if exists public.classes_intake_identity_unique_idx;

create unique index classes_academic_identity_unique_idx
  on public.classes (
    class_category,
    lower(btrim(name)),
    coalesce(grade_level, 0),
    academic_year_start
  )
  where identity_scheme = 'ACADEMIC_YEAR' and cancelled_at is null;

create unique index classes_intake_identity_unique_idx
  on public.classes (class_category, lower(btrim(name)), intake_year_month)
  where identity_scheme = 'INTAKE'
    and class_category is not null
    and cancelled_at is null;

-- Preserve the old uniqueness contract for structured rows that cannot be
-- classified safely during migration. NULL values in a composite unique index
-- are otherwise considered distinct by PostgreSQL.
create unique index classes_unclassified_academic_identity_unique_idx
  on public.classes (lower(btrim(name)), grade_level, academic_year_start)
  where identity_scheme = 'ACADEMIC_YEAR'
    and class_category is null
    and cancelled_at is null;

create unique index classes_unclassified_intake_identity_unique_idx
  on public.classes (lower(btrim(name)), intake_year_month)
  where identity_scheme = 'INTAKE'
    and class_category is null
    and cancelled_at is null;

create index if not exists classes_category_operational_idx
  on public.classes (class_category, grade_mode, grade_level, academic_year_start, end_date)
  where is_active = true and cancelled_at is null;

create index if not exists enrollments_class_status_date_idx
  on public.enrollments (class_id, status, enrollment_date);

create or replace function public.enforce_class_lifecycle_integrity()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  local_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if new.identity_scheme <> 'LEGACY' then
    if tg_op = 'INSERT' and new.start_date < local_today then
      raise exception 'class start_date cannot be before the current business date';
    end if;
    if tg_op = 'INSERT' and new.end_date < greatest(local_today + 2, new.start_date + 1) then
      raise exception 'class end_date must be at least two days after the current business date';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.start_date is not null and new.start_date is distinct from old.start_date then
      raise exception 'class start_date is immutable once configured';
    end if;
    if old.cancelled_at is not null and new.cancelled_at is null then
      raise exception 'cancelled class cannot be reopened';
    end if;
    if old.completed_at is not null and new.end_date is distinct from old.end_date then
      raise exception 'completed class end_date cannot be changed';
    end if;
    if old.end_date is not null and new.end_date is distinct from old.end_date then
      if local_today >= old.end_date then
        raise exception 'class end_date is locked on or after the final teaching day';
      end if;
      if new.end_date < local_today + 2 or new.end_date <= new.start_date then
        raise exception 'class end_date is outside the editable business range';
      end if;
      if exists (
        select 1
        from public.enrollments enrollment
        where enrollment.class_id = new.id
          and enrollment.status::text <> 'cancelled'
          and enrollment.enrollment_date >= new.end_date
      ) then
        raise exception 'class end_date conflicts with enrollment history';
      end if;
    end if;
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_class_lifecycle_integrity()
  from public, anon, authenticated;

create or replace function public.enforce_enrollment_class_date_range()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  class_start date;
  class_end date;
  class_scheme text;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select c.start_date, c.end_date, c.identity_scheme::text
    into class_start, class_end, class_scheme
  from public.classes c
  where c.id = new.class_id;

  if class_scheme <> 'LEGACY' then
    if new.enrollment_date is null then
      raise exception 'active enrollment_date is required';
    end if;
    if new.enrollment_date < class_start or new.enrollment_date >= class_end then
      raise exception 'enrollment_date must be within the class enrollment range';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_enrollment_class_date_range()
  from public, anon, authenticated;

drop trigger if exists enrollments_enforce_class_date_range on public.enrollments;
create trigger enrollments_enforce_class_date_range
before insert or update of class_id, enrollment_date, status on public.enrollments
for each row execute function public.enforce_enrollment_class_date_range();

commit;
