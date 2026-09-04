begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Canonical per-session assignments and the class-level staff pool must agree.
-- Older data could contain a valid slot assignment without the corresponding
-- class_teachers row. That drift made availability checks either reject the
-- schedule as invalid or, in staff-scoped reads, omit the occupied class.
do $$
begin
  if exists (
    select 1
      from public.class_schedule_slots slot
      join public.class_schedule_slot_staff slot_staff
        on slot_staff.slot_id = slot.id
      join public.classes class_row
        on class_row.id = slot.class_id
      join public.staff_members staff
        on staff.id = slot_staff.staff_id
     where slot.workspace_id is distinct from slot_staff.workspace_id
        or slot.workspace_id is distinct from class_row.workspace_id
        or slot.workspace_id is distinct from staff.workspace_id
  ) then
    raise exception '117 preflight failed: cross-workspace class schedule assignment';
  end if;

  if exists (
    select 1
      from public.class_schedule_slot_staff slot_staff
      join public.staff_members staff on staff.id = slot_staff.staff_id
     where slot_staff.role is distinct from staff.staff_type::text
  ) then
    raise exception '117 preflight failed: schedule assignment role differs from staff role';
  end if;
end $$;

-- Only open-ended slot versions are the current/future canonical projection.
-- Closed versions are historical evidence and must not re-add former staff to
-- the current class pool. ON CONFLICT makes the backfill safe to replay.
insert into public.class_teachers (
  workspace_id,
  class_id,
  teacher_id,
  created_at
)
select distinct
       slot.workspace_id,
       slot.class_id,
       slot_staff.staff_id,
       now()
  from public.class_schedule_slots slot
  join public.class_schedule_slot_staff slot_staff
    on slot_staff.slot_id = slot.id
 where slot.effective_until is null
on conflict (class_id, teacher_id) do nothing;

do $$
begin
  if exists (
    select 1
      from public.class_schedule_slots slot
      join public.class_schedule_slot_staff slot_staff
        on slot_staff.slot_id = slot.id
     where slot.effective_until is null
       and not exists (
         select 1
           from public.class_teachers member
          where member.class_id = slot.class_id
            and member.teacher_id = slot_staff.staff_id
            and member.workspace_id = slot.workspace_id
       )
  ) then
    raise exception '117 acceptance failed: current slot assignment is missing class membership';
  end if;
end $$;

commit;
