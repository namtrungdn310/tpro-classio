-- R8-D14 — Manual attendance correction markers (forward-only).
--
-- Admin/dev may clock in a staff member manually against a real class session
-- (manual check-in), and may undo a wrong check-in.  Financial ledgers stay
-- append-only: an undo writes a compensating REVERSAL entry and marks the
-- original attendance as reversed (never deletes history).  These columns make
-- the reversed state visible to admin review and to the UI.

begin;

alter table public.staff_attendance_entries
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid,
  add column if not exists reversal_reason text;

alter table public.staff_attendance_entries
  add constraint staff_attendance_reversal_metadata_check
  check (
    reversed_at is null
    or (reversed_at is not null and reversal_reason is not null)
  );

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'staff_attendance_entries'
       and column_name = 'reversed_at'
  ) then
    raise exception '081 acceptance failed: staff_attendance_entries.reversed_at is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.staff_attendance_entries'::regclass
       and conname = 'staff_attendance_reversal_metadata_check'
  ) then
    raise exception '081 acceptance failed: reversal metadata check is missing';
  end if;
  raise notice '081 acceptance OK: attendance reversal markers installed';
end;
$$;

commit;
