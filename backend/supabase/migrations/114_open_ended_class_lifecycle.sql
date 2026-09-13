-- Open-ended class lifecycle (expand phase).
-- Existing end_date/completed_at columns intentionally remain for a safe
-- rolling cutover and application rollback.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.classes
  add column if not exists stopped_on date,
  add column if not exists stopped_at timestamptz,
  add column if not exists stopped_reason text;

alter table public.class_lifecycle_events
  add column if not exists previous_start_date date,
  add column if not exists next_start_date date;

-- Extend the existing audit contract before the application starts writing the
-- two open-ended lifecycle actions. Replacing (instead of renaming) the check
-- keeps upgrades deterministic regardless of which older migration created it.
alter table public.class_lifecycle_events
  drop constraint if exists class_lifecycle_events_event_type_check;

alter table public.class_lifecycle_events
  add constraint class_lifecycle_events_event_type_check check (
    event_type = any (array[
      'created', 'identity_configured', 'end_date_changed', 'completed',
      'cancelled', 'archived', 'restored', 'schedule_changed',
      'schedule_slot_edited', 'schedule_slot_closed', 'start_date_changed',
      'stopped'
    ])
  ) not valid;

alter table public.class_lifecycle_events
  validate constraint class_lifecycle_events_event_type_check;

-- Structured classes now require only a start date. The legacy end_date stays
-- readable during the rolling cutover but no longer bounds the lifecycle.
alter table public.classes
  drop constraint if exists classes_lifecycle_dates_check;

alter table public.classes
  add constraint classes_lifecycle_dates_check check (
    identity_scheme = 'LEGACY' or start_date is not null
  ) not valid;

alter table public.classes validate constraint classes_lifecycle_dates_check;

alter table public.classes
  drop constraint if exists classes_stopped_shape_check;

alter table public.classes
  add constraint classes_stopped_shape_check check (
    (stopped_on is null and stopped_at is null and stopped_reason is null)
    or
    (stopped_on is not null and stopped_at is not null
      and char_length(btrim(stopped_reason)) between 3 and 500)
  ) not valid;

-- Preserve genuinely historical completed rows. Active/future-ended classes
-- keep their legacy end_date during the compatibility window, but new runtime
-- code no longer treats it as an operational boundary.
update public.classes
set stopped_on = coalesce(end_date, (completed_at at time zone 'Asia/Ho_Chi_Minh')::date),
    stopped_at = coalesce(completed_at, now()),
    stopped_reason = coalesce(nullif(btrim(cancelled_reason), ''), 'Lớp đã hoàn tất trước khi chuyển đổi vòng đời')
where completed_at is not null
  and cancelled_at is null
  and stopped_at is null;

alter table public.classes validate constraint classes_stopped_shape_check;

create index if not exists classes_open_lifecycle_scope_idx
  on public.classes (workspace_id, start_date, id)
  where stopped_at is null and cancelled_at is null and is_active = true;

-- Replace the former immutable-start/end-date trigger. Optimistic locking and
-- audited start-date changes are enforced by the service command, while the DB
-- continues to prevent reopening terminal rows and owns version timestamps.
create or replace function public.enforce_class_lifecycle_integrity()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' then
    if old.cancelled_at is not null and new.cancelled_at is null then
      raise exception 'cancelled class cannot be reopened';
    end if;
    if old.stopped_at is not null and new.stopped_at is null then
      raise exception 'stopped class cannot be reopened';
    end if;
    if new.start_date is distinct from old.start_date and exists (
      select 1
      from public.enrollments enrollment
      where enrollment.class_id = new.id
        and enrollment.status::text <> 'cancelled'
        and enrollment.enrollment_date < new.start_date
    ) then
      raise exception 'class start_date conflicts with enrollment history';
    end if;
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

-- The legacy package trigger must no longer derive package validity from an
-- obsolete end_date. Course length is represented by the billing cadence;
-- the class itself remains open until it is explicitly stopped.
create or replace function public.enforce_class_package_cycle_integrity()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.type::text = 'MONTHLY' then
    new.billing_cycle_months := 1;
    new.billing_cycle_weeks := null;
    return new;
  end if;
  if new.billing_cycle_weeks is null or new.billing_cycle_weeks < 1 then
    raise exception 'course billing_cycle_weeks must be at least one';
  end if;
  return new;
end;
$$;

-- Active enrollment validity is now [start_date, explicit stop). Legacy
-- end_date is deliberately ignored. Direct database writers receive the same
-- terminal-state and package-boundary protection as the API service.
create or replace function public.enforce_enrollment_class_date_range()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  class_start date;
  class_scheme text;
  class_type text;
  class_cycle_weeks integer;
  class_is_active boolean;
  class_cancelled_at timestamptz;
  class_completed_at timestamptz;
  class_stopped_at timestamptz;
  cycle_days integer;
begin
  if new.status::text <> 'active' then
    return new;
  end if;

  select c.start_date, c.identity_scheme::text, c.type::text,
         c.billing_cycle_weeks, c.is_active, c.cancelled_at, c.completed_at,
         c.stopped_at
    into class_start, class_scheme, class_type, class_cycle_weeks,
         class_is_active, class_cancelled_at, class_completed_at,
         class_stopped_at
  from public.classes c
  where c.id = new.class_id;

  if not found then
    raise exception 'enrollment class does not exist';
  end if;
  if not class_is_active or class_cancelled_at is not null
     or class_completed_at is not null or class_stopped_at is not null then
    raise exception 'active enrollment requires an operational class';
  end if;
  if class_scheme <> 'LEGACY' then
    if new.enrollment_date is null then
      raise exception 'active enrollment_date is required';
    end if;
    if new.enrollment_date < class_start then
      raise exception 'enrollment_date must be on or after class start_date';
    end if;
    if class_type = 'COURSE' then
      if class_cycle_weeks is null or class_cycle_weeks < 1 then
        raise exception 'course billing_cycle_weeks is invalid';
      end if;
      cycle_days := class_cycle_weeks * 7;
      if mod(new.enrollment_date - class_start, cycle_days) <> 0 then
        raise exception 'enrollment_date must start on a package boundary';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_class_package_cycle_integrity()
  from public, anon, authenticated;
revoke all on function public.enforce_enrollment_class_date_range()
  from public, anon, authenticated;

-- Atomic release marker used by application readiness. Because this function
-- is created last in the same transaction, its presence proves the complete
-- migration committed rather than only the first three columns.
create or replace function public.open_ended_class_lifecycle_version()
returns integer
language sql
immutable
set search_path = pg_catalog
as $$ select 1 $$;

revoke all on function public.open_ended_class_lifecycle_version()
  from public, anon, authenticated;

commit;
