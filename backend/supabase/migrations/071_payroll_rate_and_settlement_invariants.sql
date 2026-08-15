-- R7-D09 — Payroll Rate, Ledger, and Settlement Invariants (forward-only).
--
-- 1. Ensure staff compensation rate non-overlap trigger strictly enforces half-open [effective_from, effective_to);
-- 2. Refine staff_earning_ledger uniqueness: partial unique index on primary EARNING, unique on request_id;
-- 3. Add unique index on staff_payroll_settlements (request_id);
-- 4. Add global unique index on staff_payroll_settlement_items (ledger_entry_id) to guarantee exactly-once settlement;
-- 5. RLS & least-privilege grants verification.

begin;

-- ===========================================================================
-- 1. Preflight: Check for rate overlaps and duplicate ledger settlements
-- ===========================================================================
do $$
declare
  overlapping_rates integer;
  duplicate_settled_items integer;
begin
  select count(*) into overlapping_rates
    from public.staff_compensation_rates left_rate
    join public.staff_compensation_rates right_rate
      on left_rate.staff_id = right_rate.staff_id
     and left_rate.id < right_rate.id
     and left_rate.effective_from < coalesce(right_rate.effective_to, 'infinity'::date)
     and right_rate.effective_from < coalesce(left_rate.effective_to, 'infinity'::date);

  if overlapping_rates > 0 then
    raise exception '071 preflight abort: % overlapping compensation rate pair(s) found.', overlapping_rates;
  end if;

  -- Check for existing duplicate ledger items in settlements
  select count(*) into duplicate_settled_items
    from (
      select ledger_entry_id, count(*)
        from public.staff_payroll_settlement_items
       group by ledger_entry_id
      having count(*) > 1
    ) dup;

  if duplicate_settled_items > 0 then
    raise exception '071 preflight abort: % duplicate settled ledger entry item(s) found.', duplicate_settled_items;
  end if;
end;
$$;

-- ===========================================================================
-- 2. Refine compensation rates half-open trigger & check constraint
-- ===========================================================================
alter table public.staff_compensation_rates
  drop constraint if exists staff_compensation_rates_range;

alter table public.staff_compensation_rates
  add constraint staff_compensation_rates_range
  check (effective_from < effective_to or effective_to is null) not valid;

alter table public.staff_compensation_rates
  validate constraint staff_compensation_rates_range;

create or replace function public.staff_compensation_rates_no_overlap()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1
      from public.staff_compensation_rates other
     where other.staff_id = new.staff_id
       and other.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
       and other.effective_from < coalesce(new.effective_to, 'infinity'::date)
       and coalesce(other.effective_to, 'infinity'::date) > new.effective_from
  ) then
    raise exception 'compensation rate ranges must not overlap';
  end if;
  return new;
end;
$$;

revoke all on function public.staff_compensation_rates_no_overlap() from public, anon, authenticated;

-- ===========================================================================
-- 3. Staff Earning Ledger Invariants
-- ===========================================================================
alter table public.staff_earning_ledger
  drop constraint if exists staff_earning_attendance_uniq;

create unique index if not exists staff_earning_primary_uniq
  on public.staff_earning_ledger (attendance_entry_id)
  where entry_type = 'EARNING';

create unique index if not exists staff_earning_request_uniq
  on public.staff_earning_ledger (request_id);

-- ===========================================================================
-- 4. Staff Settlement Invariants
-- ===========================================================================
create unique index if not exists staff_payroll_settlements_request_uniq
  on public.staff_payroll_settlements (request_id);

create unique index if not exists staff_payroll_settlement_items_ledger_uniq
  on public.staff_payroll_settlement_items (ledger_entry_id);

-- ===========================================================================
-- 5. RLS and Grants
-- ===========================================================================
alter table public.staff_compensation_rates enable row level security;
alter table public.staff_compensation_rates force row level security;
alter table public.staff_compensation_rate_events enable row level security;
alter table public.staff_compensation_rate_events force row level security;
alter table public.staff_attendance_entries enable row level security;
alter table public.staff_attendance_entries force row level security;
alter table public.staff_earning_ledger enable row level security;
alter table public.staff_earning_ledger force row level security;
alter table public.staff_payroll_settlements enable row level security;
alter table public.staff_payroll_settlements force row level security;
alter table public.staff_payroll_settlement_items enable row level security;
alter table public.staff_payroll_settlement_items force row level security;

revoke all on table public.staff_compensation_rates from public, anon, authenticated;
revoke all on table public.staff_compensation_rate_events from public, anon, authenticated;
revoke all on table public.staff_attendance_entries from public, anon, authenticated;
revoke all on table public.staff_earning_ledger from public, anon, authenticated;
revoke all on table public.staff_payroll_settlements from public, anon, authenticated;
revoke all on table public.staff_payroll_settlement_items from public, anon, authenticated;

-- ===========================================================================
-- 6. Acceptance Verification
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where tablename = 'staff_earning_ledger'
       and indexname = 'staff_earning_primary_uniq'
  ) then
    raise exception '071 acceptance failed: staff_earning_primary_uniq index missing';
  end if;

  if not exists (
    select 1 from pg_indexes
     where tablename = 'staff_payroll_settlement_items'
       and indexname = 'staff_payroll_settlement_items_ledger_uniq'
  ) then
    raise exception '071 acceptance failed: staff_payroll_settlement_items_ledger_uniq index missing';
  end if;

  raise notice '071 acceptance OK: payroll rate, ledger, and settlement invariants enforced successfully.';
end;
$$;

commit;
