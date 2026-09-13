-- Keep staff attendance reads bounded as the ledger grows.
-- The history screen sorts by occurrence time; the manual backfill picker
-- narrows by staff + source slot + occurrence time.  The existing index on
-- checkin_at cannot support either access pattern efficiently.
begin;

create index if not exists staff_attendance_entries_staff_occurrence_idx
  on public.staff_attendance_entries (staff_id, occurrence_start_at desc);

create index if not exists staff_attendance_entries_staff_slot_occurrence_idx
  on public.staff_attendance_entries (
    staff_id,
    occurrence_slot_id,
    occurrence_start_at
  );

do $$
begin
  if to_regclass('public.staff_attendance_entries_staff_occurrence_idx') is null
     or to_regclass('public.staff_attendance_entries_staff_slot_occurrence_idx') is null then
    raise exception '104 acceptance failed: attendance lookup indexes are missing';
  end if;
end $$;

commit;
