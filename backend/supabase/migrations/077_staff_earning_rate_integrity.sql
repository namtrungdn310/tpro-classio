-- R7-D10 — Per-staff, per-session earning integrity (forward-only).
--
-- A session may have multiple teachers.  Each teacher checks in separately and
-- earns the full rate effective for that teacher on the session date.  This
-- migration makes the invariant database-enforceable: an EARNING row must
-- belong to the same staff member as its attendance entry and must equal the
-- immutable rate snapshot captured on that attendance entry.  There is no
-- class-level rate and no pro-rata/split calculation.

begin;

do $$
begin
  if exists (
    select 1
      from public.staff_earning_ledger earning
      left join public.staff_attendance_entries attendance
        on attendance.id = earning.attendance_entry_id
     where earning.entry_type = 'EARNING'
       and (
         attendance.id is null
         or earning.staff_id <> attendance.staff_id
         or earning.amount <> attendance.rate_amount
         or earning.amount <= 0
       )
  ) then
    raise exception
      '077 preflight abort: an existing EARNING row violates staff/rate snapshot integrity';
  end if;
end;
$$;

create or replace function public.validate_staff_earning_rate_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  attendance_staff uuid;
  attendance_rate bigint;
begin
  if new.entry_type <> 'EARNING' then
    return new;
  end if;

  select staff_id, rate_amount
    into attendance_staff, attendance_rate
    from public.staff_attendance_entries
   where id = new.attendance_entry_id;

  if attendance_staff is null then
    raise exception 'earning must reference an existing attendance entry';
  end if;
  if new.staff_id <> attendance_staff then
    raise exception 'earning staff must match attendance staff';
  end if;
  if new.amount <= 0 or new.amount <> attendance_rate then
    raise exception
      'earning amount must equal the staff rate snapshot for this session';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_staff_earning_rate_snapshot() from public, anon, authenticated;

drop trigger if exists staff_earning_rate_snapshot_integrity on public.staff_earning_ledger;
create trigger staff_earning_rate_snapshot_integrity
before insert on public.staff_earning_ledger
for each row execute function public.validate_staff_earning_rate_snapshot();

alter table public.staff_earning_ledger enable row level security;
alter table public.staff_earning_ledger force row level security;
revoke all on table public.staff_earning_ledger from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.staff_earning_ledger'::regclass
       and tgname = 'staff_earning_rate_snapshot_integrity'
       and not tgisinternal
       and tgenabled <> 'D'
  ) then
    raise exception '077 acceptance failed: staff earning integrity trigger is missing';
  end if;
  raise notice '077 acceptance OK: each teacher earns the full personal rate per session';
end;
$$;

commit;
