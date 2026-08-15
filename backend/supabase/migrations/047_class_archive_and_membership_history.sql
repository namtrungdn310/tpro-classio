-- Class archive is an organisational view state, deliberately separate from
-- teaching lifecycle.  A completed/cancelled class remains immutable business
-- history; archive only removes it from day-to-day operational lists.
--
-- This migration is forward-only and must be applied after 046.

begin;

alter table public.classes
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid
    references public.profiles(id) on delete set null,
  add column if not exists archive_reason text,
  add column if not exists archived_by_name_snapshot text;

alter table public.classes
  drop constraint if exists classes_archive_state_check,
  add constraint classes_archive_state_check
    check (
      archived_at is null
      or (completed_at is not null or cancelled_at is not null)
    ) not valid;

alter table public.classes
  drop constraint if exists classes_archive_metadata_check,
  add constraint classes_archive_metadata_check
    check (
      archived_at is not null
      or (
        archived_by is null
        and archive_reason is null
        and archived_by_name_snapshot is null
      )
    ) not valid,
  drop constraint if exists classes_archive_reason_check,
  add constraint classes_archive_reason_check
    check (
      archive_reason is null
      or char_length(btrim(archive_reason)) between 3 and 300
    ) not valid;

alter table public.classes
  drop constraint if exists classes_archive_actor_snapshot_check,
  add constraint classes_archive_actor_snapshot_check
    check (
      archived_by_name_snapshot is null
      or char_length(btrim(archived_by_name_snapshot)) between 1 and 120
    ) not valid;

create index if not exists classes_archive_browse_idx
  on public.classes (archived_at desc, updated_at desc, id)
  where archived_at is not null;

-- Keep every teaching assignment independently from the current
-- class_teachers projection.  The snapshot prevents a later staff-name edit
-- from rewriting what the class history shows.
create table if not exists public.class_teacher_events (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  teacher_id uuid not null references public.staff_members(id) on delete restrict,
  teacher_name_snapshot text not null,
  event_type text not null check (event_type in ('assigned', 'unassigned')),
  actor_user_id uuid references public.profiles(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index if not exists class_teacher_events_class_time_idx
  on public.class_teacher_events (class_id, occurred_at desc, id desc);

create or replace function public.block_class_teacher_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'class teacher history is append-only'
    using errcode = '42501';
end;
$$;

revoke all on function public.block_class_teacher_event_mutation()
  from public, anon, authenticated;

drop trigger if exists trg_class_teacher_events_append_only
  on public.class_teacher_events;
create trigger trg_class_teacher_events_append_only
before update or delete on public.class_teacher_events
for each row execute function public.block_class_teacher_event_mutation();

drop trigger if exists trg_class_teacher_events_truncate
  on public.class_teacher_events;
create trigger trg_class_teacher_events_truncate
before truncate on public.class_teacher_events
for each statement execute function public.block_class_teacher_event_mutation();

-- Existing current assignments become the first historical assignment.  This
-- is idempotent and never guesses a prior removal date.
insert into public.class_teacher_events (
  class_id, teacher_id, teacher_name_snapshot, event_type, occurred_at
)
select ct.class_id, ct.teacher_id, staff.full_name, 'assigned', ct.created_at
from public.class_teachers ct
join public.staff_members staff on staff.id = ct.teacher_id
where not exists (
  select 1
  from public.class_teacher_events event
  where event.class_id = ct.class_id
    and event.teacher_id = ct.teacher_id
    and event.event_type = 'assigned'
);

-- An enrolment is a membership period, not a reusable mutable row.  Existing
-- fee records keep their original enrollment_id forever; a returning learner
-- receives a new enrollment row.  Only one active period per student/class is
-- allowed.
alter table public.enrollments
  add column if not exists ended_at timestamptz,
  add column if not exists end_reason text;

-- Backfill only timestamps that are evidenced by an existing class lifecycle
-- marker.  A past date or a non-active enrollment alone is not proof of the
-- exact leaving moment, so those rows intentionally remain NULL rather than
-- inventing historical data.
update public.enrollments as enrollment
set
  ended_at = case enrollment.status
    when 'completed' then class_.completed_at
    when 'cancelled' then class_.cancelled_at
    else enrollment.ended_at
  end,
  end_reason = coalesce(
    enrollment.end_reason,
    case enrollment.status
      when 'completed' then 'Lớp hoàn tất theo ngày học cuối cùng'
      when 'cancelled' then 'Lớp đã bị hủy'
      else null
    end
  )
from public.classes as class_
where class_.id = enrollment.class_id
  and enrollment.ended_at is null
  and (
    (enrollment.status = 'completed' and class_.completed_at is not null)
    or (enrollment.status = 'cancelled' and class_.cancelled_at is not null)
  );

alter table public.enrollments
  drop constraint if exists enrollments_student_id_class_id_key;

create unique index if not exists enrollments_one_active_period_idx
  on public.enrollments (student_id, class_id)
  where status = 'active';

create index if not exists enrollments_class_history_idx
  on public.enrollments (class_id, enrollment_date, created_at desc);

alter table public.class_lifecycle_events
  drop constraint if exists class_lifecycle_events_event_type_check,
  add constraint class_lifecycle_events_event_type_check
    check (event_type in (
      'created', 'identity_configured', 'end_date_changed', 'completed',
      'cancelled', 'archived', 'restored'
    )) not valid;

-- Audit/history tables are server-only.  The FastAPI service authorizes every
-- response; browser credentials can neither read nor mutate these records.
alter table public.class_teacher_events enable row level security;
alter table public.class_teacher_events force row level security;
revoke all on table public.class_teacher_events from public, anon, authenticated;
revoke update, delete, truncate on table public.class_teacher_events from service_role;

revoke update, delete, truncate on table public.enrollments from anon, authenticated;

commit;
