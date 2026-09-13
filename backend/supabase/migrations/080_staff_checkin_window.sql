-- R8-D13 — Per-staff attendance check-in window (forward-only).
--
-- Check-in is only allowed from the exact start of the class session until
-- `checkin_window_after_hours` hours later (Asia/Ho_Chi_Minh business time).
-- There is deliberately no pre-start window: a staff member cannot clock in
-- before the session begins.  Admin may customise the window per staff member;
-- the default is 24 hours.  After the window closes the session can no longer
-- be clocked in (the schedule/lifecycle keeps it, but attendance is locked).
--
-- The column is integer hours (>= 1) so a small value like 1 hour is valid for
-- testing, while a centre that allows next-day catch-up can set 24+.

begin;

alter table public.staff_members
  add column if not exists checkin_window_after_hours integer not null default 24;

alter table public.staff_members
  add constraint staff_members_checkin_window_after_hours_check
  check (checkin_window_after_hours >= 1);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'staff_members'
       and column_name = 'checkin_window_after_hours'
  ) then
    raise exception '080 acceptance failed: staff_members.checkin_window_after_hours is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.staff_members'::regclass
       and conname = 'staff_members_checkin_window_after_hours_check'
  ) then
    raise exception '080 acceptance failed: checkin window constraint is missing';
  end if;
  raise notice '080 acceptance OK: per-staff check-in window installed (default 24h)';
end;
$$;

commit;
