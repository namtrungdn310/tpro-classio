-- Forward-only successor to the already applied 041 migration.
--
-- This migration is safe for both paths:
--   1. the existing database, where 041 is already recorded; and
--   2. a new staging database, where this file establishes the complete class
--      lifecycle/identity contract after migrations 001–040.
--
-- Existing classes intentionally remain LEGACY. Historical identifiers and
-- dates are never inferred from a name or created_at value.

begin;

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'class_identity_scheme'
  ) then
    create type public.class_identity_scheme as enum (
      'LEGACY', 'ACADEMIC_YEAR', 'INTAKE'
    );
  end if;
end
$$;

alter table public.classes
  add column if not exists identity_scheme public.class_identity_scheme not null default 'LEGACY',
  add column if not exists program_name text,
  add column if not exists grade_level smallint,
  add column if not exists education_level text,
  add column if not exists academic_year_start smallint,
  add column if not exists intake_year_month integer generated always as (
    case
      when start_date is null then null
      else (extract(year from start_date)::integer * 100) + extract(month from start_date)::integer
    end
  ) stored,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_reason text,
  add column if not exists completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists version integer not null default 1;

alter table public.enrollments
  alter column status drop default;
alter type public.enrollment_status add value if not exists 'completed';
alter type public.enrollment_status add value if not exists 'cancelled';
alter table public.enrollments
  alter column status set default 'active';

create table if not exists public.class_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  event_type text not null check (
    event_type in ('created', 'identity_configured', 'end_date_changed', 'completed', 'cancelled')
  ),
  previous_end_date date,
  next_end_date date,
  reason text,
  actor_user_id uuid references public.profiles(id) on delete set null,
  request_id uuid,
  business_date date not null,
  occurred_at timestamptz not null default now(),
  constraint class_lifecycle_events_reason_length_check
    check (reason is null or char_length(btrim(reason)) between 3 and 500)
);

alter table public.class_lifecycle_events
  add column if not exists request_id uuid,
  add column if not exists business_date date,
  add column if not exists occurred_at timestamptz not null default now();

-- The old 041 contract used the previous identity fields. Replace it without
-- validating legacy rows; all newly inserted/updated structured classes are
-- still enforced by PostgreSQL immediately.
alter table public.classes
  drop constraint if exists classes_lifecycle_dates_check,
  drop constraint if exists classes_identity_shape_check,
  drop constraint if exists classes_education_level_matches_grade_check,
  drop constraint if exists classes_schedule_max_four_slots_check;

-- 041 may have stored the school band in a former metadata column. Preserve
-- that historical column for now, but make the new canonical value trusted and
-- derivable from grade_level. This never fabricates a grade. Intake classes are
-- identified by the entered class name and their opening month, so the former
-- programme field is intentionally cleared only for that identity scheme.
update public.classes
set education_level = case
  when grade_level between 1 and 5 then 'PRIMARY'
  when grade_level between 6 and 9 then 'MIDDLE'
  when grade_level between 10 and 12 then 'HIGH'
  else null
end
where identity_scheme = 'ACADEMIC_YEAR'
  and grade_level is not null;

update public.classes
set program_name = null
where identity_scheme = 'INTAKE';

alter table public.classes
  add constraint classes_lifecycle_dates_check
  check (
    identity_scheme = 'LEGACY'
    or (start_date is not null and end_date is not null and end_date >= start_date)
  ) not valid,
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
  ) not valid,
  add constraint classes_education_level_matches_grade_check
  check (
    identity_scheme <> 'ACADEMIC_YEAR'
    or (grade_level between 1 and 5 and education_level = 'PRIMARY')
    or (grade_level between 6 and 9 and education_level = 'MIDDLE')
    or (grade_level between 10 and 12 and education_level = 'HIGH')
  ) not valid,
  add constraint classes_schedule_max_four_slots_check
  check (
    schedule is null
    or not (schedule ? 'slots')
    or (
      jsonb_typeof(schedule -> 'slots') = 'array'
      and jsonb_array_length(schedule -> 'slots') <= 4
    )
  ) not valid;

drop index if exists public.classes_active_name_unique_idx;
drop index if exists public.classes_academic_identity_unique_idx;
drop index if exists public.classes_intake_identity_unique_idx;

create unique index classes_academic_identity_unique_idx
  on public.classes (lower(btrim(name)), grade_level, academic_year_start)
  where identity_scheme = 'ACADEMIC_YEAR';

create unique index classes_intake_identity_unique_idx
  on public.classes (lower(btrim(name)), intake_year_month)
  where identity_scheme = 'INTAKE';

create index if not exists classes_operational_dates_idx
  on public.classes (is_active, cancelled_at, start_date, end_date, created_at desc);
create index if not exists class_lifecycle_events_class_occurred_idx
  on public.class_lifecycle_events (class_id, occurred_at desc);
create unique index if not exists class_lifecycle_events_request_event_uniq
  on public.class_lifecycle_events (class_id, request_id, event_type)
  where request_id is not null;

create or replace function public.enforce_class_lifecycle_integrity()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  local_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
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
      if new.end_date <= local_today then
        raise exception 'class end_date must remain in the future';
      end if;
    end if;

    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists classes_enforce_lifecycle_integrity on public.classes;
create trigger classes_enforce_lifecycle_integrity
before update on public.classes
for each row execute function public.enforce_class_lifecycle_integrity();

alter table public.class_lifecycle_events enable row level security;
alter table public.class_lifecycle_events force row level security;
revoke all on table public.class_lifecycle_events from anon, authenticated;
revoke update, delete, truncate on table public.class_lifecycle_events from service_role;

create or replace function public.block_class_lifecycle_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'class lifecycle events are append-only';
end;
$$;

revoke all on function public.block_class_lifecycle_event_mutation()
  from public, anon, authenticated;

drop trigger if exists class_lifecycle_events_block_update on public.class_lifecycle_events;
create trigger class_lifecycle_events_block_update
before update or delete on public.class_lifecycle_events
for each row execute function public.block_class_lifecycle_event_mutation();

drop trigger if exists class_lifecycle_events_block_truncate on public.class_lifecycle_events;
create trigger class_lifecycle_events_block_truncate
before truncate on public.class_lifecycle_events
for each statement execute function public.block_class_lifecycle_event_mutation();

create or replace function public.block_class_hard_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'classes are historical records and cannot be physically deleted';
end;
$$;

drop trigger if exists classes_block_hard_delete on public.classes;
create trigger classes_block_hard_delete
before delete on public.classes
for each row execute function public.block_class_hard_delete();

commit;
