-- R9.3 — reconcile databases that applied the workspace migrations before
-- the optional staff/attendance migrations or provisioned the production
-- runtime role as `tpro_backend` instead of the disposable-test role
-- `tpro_runtime`.
--
-- This migration is deliberately idempotent.  It does not remove or rewrite
-- existing staff/attendance data; it only installs the forward-only columns,
-- constraints and the minimum workspace helper EXECUTE grants needed by the
-- backend service role.

begin;

alter table public.staff_members
  add column if not exists email text,
  add column if not exists checkin_window_after_hours integer
    not null default 24;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.staff_members'::regclass
       and conname = 'staff_members_email_blank_check'
  ) then
    alter table public.staff_members
      add constraint staff_members_email_blank_check
      check (email is null or btrim(email) <> '');
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.staff_members'::regclass
       and conname = 'staff_members_checkin_window_after_hours_check'
  ) then
    alter table public.staff_members
      add constraint staff_members_checkin_window_after_hours_check
      check (checkin_window_after_hours >= 1);
  end if;
end;
$$;

alter table public.staff_attendance_entries
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid,
  add column if not exists reversal_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.staff_attendance_entries'::regclass
       and conname = 'staff_attendance_reversal_metadata_check'
  ) then
    alter table public.staff_attendance_entries
      add constraint staff_attendance_reversal_metadata_check
      check (
        reversed_at is null
        or (reversed_at is not null and reversal_reason is not null)
      );
  end if;
end;
$$;

do $$
declare
  runtime_role name;
begin
  -- Production uses tpro_backend; disposable upgrade tests use tpro_runtime.
  -- Keep both names supported so a database can be upgraded before/after
  -- runtime-role provisioning without reopening PUBLIC/Browser EXECUTE.
  for runtime_role in
    select rolname
      from pg_roles
     where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    if to_regprocedure('public.current_workspace_id()') is not null then
      execute format(
        'grant execute on function public.current_workspace_id() to %I',
        runtime_role
      );
    end if;
    if to_regprocedure('public.stamp_workspace_id()') is not null then
      execute format(
        'grant execute on function public.stamp_workspace_id() to %I',
        runtime_role
      );
    end if;
  end loop;
end;
$$;

commit;
