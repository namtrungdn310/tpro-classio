-- R7-D08 — per-slot teacher assignment history.
--
-- `class_schedule_slot_staff` remains the current projection.  This table is
-- append-only history for TEACHER assignments only; assistant behavior is
-- intentionally unchanged.  A teacher's rate is resolved from
-- staff_compensation_rates, never from the class or this table.

begin;

do $$
begin
  if exists (
    select 1
      from public.class_schedule_slots s
      join public.class_schedule_slot_staff ss on ss.slot_id = s.id
      where ss.role = 'TEACHER'
        and not exists (
          select 1 from public.staff_members sm
           where sm.id = ss.staff_id and sm.staff_type = 'TEACHER'
        )
  ) then
    raise exception 'M076 preflight abort: slot teacher projection contains non-TEACHER staff';
  end if;
end;
$$;

create table if not exists public.class_schedule_slot_teacher_events (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  slot_id uuid not null references public.class_schedule_slots(id) on delete restrict,
  staff_id uuid not null references public.staff_members(id) on delete restrict,
  event_type text not null check (event_type in ('ASSIGNED', 'REMOVED', 'REPLACED')),
  effective_from date not null,
  effective_until date,
  teacher_name_snapshot text not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  reason text,
  request_id uuid,
  created_at timestamptz not null default now(),
  constraint class_schedule_slot_teacher_events_range_check
    check (effective_until is null or effective_from < effective_until),
  constraint class_schedule_slot_teacher_events_staff_check
    check (char_length(trim(teacher_name_snapshot)) between 1 and 160),
  constraint class_schedule_slot_teacher_events_reason_check
    check (reason is null or char_length(trim(reason)) between 3 and 500)
);

create index if not exists class_schedule_slot_teacher_events_slot_time_idx
  on public.class_schedule_slot_teacher_events (slot_id, effective_from, created_at);
create index if not exists class_schedule_slot_teacher_events_class_time_idx
  on public.class_schedule_slot_teacher_events (class_id, effective_from desc, created_at desc);
create index if not exists class_schedule_slot_teacher_events_staff_time_idx
  on public.class_schedule_slot_teacher_events (staff_id, effective_from, effective_until);
create unique index if not exists class_schedule_slot_teacher_events_request_uniq
  on public.class_schedule_slot_teacher_events (request_id)
  where request_id is not null;

create or replace function public.block_class_schedule_slot_teacher_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'slot teacher assignment history is append-only'
    using errcode = '55000';
end;
$$;

drop trigger if exists class_schedule_slot_teacher_events_append_only
  on public.class_schedule_slot_teacher_events;
create trigger class_schedule_slot_teacher_events_append_only
before update or delete on public.class_schedule_slot_teacher_events
for each row execute function public.block_class_schedule_slot_teacher_event_mutation();

drop trigger if exists class_schedule_slot_teacher_events_truncate
  on public.class_schedule_slot_teacher_events;
create trigger class_schedule_slot_teacher_events_truncate
before truncate on public.class_schedule_slot_teacher_events
for each statement execute function public.block_class_schedule_slot_teacher_event_mutation();

alter table public.class_schedule_slot_teacher_events enable row level security;
alter table public.class_schedule_slot_teacher_events force row level security;
revoke all on table public.class_schedule_slot_teacher_events from public, anon, authenticated;
revoke update, delete, truncate on table public.class_schedule_slot_teacher_events from service_role;
revoke all on function public.block_class_schedule_slot_teacher_event_mutation() from public, anon, authenticated;

-- Backfill the initial assignment state exactly once.  The current slot
-- projection is evidence for the initial event; no historical rows are
-- invented beyond the slot's effective_from date.
insert into public.class_schedule_slot_teacher_events (
  class_id, slot_id, staff_id, event_type, effective_from,
  teacher_name_snapshot, reason
)
select
  s.class_id,
  s.id,
  ss.staff_id,
  'ASSIGNED',
  s.effective_from,
  sm.full_name,
  'Backfill assignment lịch sử từ projection canonical'
from public.class_schedule_slots s
join public.class_schedule_slot_staff ss
  on ss.slot_id = s.id and ss.role = 'TEACHER'
join public.staff_members sm on sm.id = ss.staff_id
where not exists (
  select 1
    from public.class_schedule_slot_teacher_events existing
   where existing.slot_id = s.id
     and existing.staff_id = ss.staff_id
     and existing.event_type = 'ASSIGNED'
     and existing.effective_from = s.effective_from
);

commit;
