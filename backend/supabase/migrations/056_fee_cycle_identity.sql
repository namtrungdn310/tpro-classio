-- R6-D05 — Fee-cycle identity expand + legacy backfill (forward-only).
--
-- Contract: dev.md §7.1, test.md §2.2. Adds canonical cycle identity
-- `(enrollment_id, cycle_no)` 0-based; legacy records are numbered 1..n with
-- `origin = 'LEGACY_BACKFILL'` (cycle 0 is NEVER retro-charged). `period`
-- stays a reporting bucket; the old unique `(enrollment_id, period)` index is
-- kept during the expand phase (dropped at D19 after parity).
--
-- Amounts, statuses, notifications and payment/refund/operation links are
-- NEVER rewritten; parity is proven against an immutable snapshot.

begin;

-- ===========================================================================
-- 1. Preflight (no mutation yet) + immutable snapshot
-- ===========================================================================
do $$
declare
  missing_enrollment_date bigint;
  missing_period bigint;
  duplicate_due bigint;
  missing_enrollment bigint;
  course_without_weeks bigint;
  already_cycled bigint;
  total_records bigint;
  has_cycle_column boolean;
begin
  select count(*) into total_records from public.fee_records;

  -- Ambiguous data checks FIRST: these must never be hidden by state checks.
  select count(*) into missing_enrollment_date
    from public.fee_records r
    join public.enrollments e on e.id = r.enrollment_id
   where e.enrollment_date is null;

  select count(*) into missing_period
    from public.fee_records where period is null;

  select count(*) into duplicate_due
    from (
      select enrollment_id, due_date
        from public.fee_records
       where due_date is not null
       group by enrollment_id, due_date
      having count(*) > 1
    ) x;

  select count(*) into missing_enrollment
    from public.fee_records r
   where not exists (select 1 from public.enrollments e where e.id = r.enrollment_id);

  select count(*) into course_without_weeks
    from public.fee_records
   where class_type_snapshot = 'COURSE'
     and billing_cycle_weeks_snapshot is null;

  if missing_enrollment_date > 0 or missing_period > 0 or missing_enrollment > 0 then
    raise exception 'M056 preflight abort: missing dates/period/orphans (enrollment_date=%, period=%, orphan=%)',
      missing_enrollment_date, missing_period, missing_enrollment;
  end if;
  if duplicate_due > 0 then
    raise exception 'M056 preflight abort: % record(s) with ambiguous duplicate due evidence; resolve manually, do not guess', duplicate_due;
  end if;
  if course_without_weeks > 0 then
    raise exception 'M056 preflight abort: % COURSE record(s) without billing_cycle_weeks_snapshot; ambiguous coverage', course_without_weeks;
  end if;

  -- State checks (rerun/partial) come after data integrity.
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'fee_records'
       and column_name = 'cycle_no'
  ) into has_cycle_column;
  if has_cycle_column then
    select count(*) into already_cycled
      from public.fee_records where cycle_no is not null;
  else
    already_cycled := 0;
  end if;

  if already_cycled > 0 and already_cycled = total_records then
    raise notice 'M056 rerun: already cycled (records=%), no-op path', total_records;
    return;
  end if;
  if already_cycled > 0 then
    raise exception 'M056 preflight abort: partial cycle state (cycled=%, total=%)',
      already_cycled, total_records;
  end if;

  raise notice 'M056 preflight OK: records=%, missing_date=%, dup_due=%, course_weeks_missing=%',
    total_records, missing_enrollment_date, duplicate_due, course_without_weeks;
end;
$$;

-- ===========================================================================
-- 2. Immutable evidence snapshot (run_id-scoped)
-- ===========================================================================
create table if not exists public._migration_056_fee_cycle_snapshot (
  run_id text not null default 'M056-R6',
  record_id uuid not null primary key,
  enrollment_id uuid not null,
  period text not null,
  due_date date,
  base_amount numeric(12,0) not null,
  discount_amount numeric(12,0) not null,
  final_amount numeric(12,0) not null,
  status public.fee_status not null,
  notified_at timestamptz,
  paid_amount numeric(12,0),
  refunded_amount numeric(12,0) not null,
  payment_count bigint not null,
  backed_up_at timestamptz not null default now()
);

insert into public._migration_056_fee_cycle_snapshot (
  run_id, record_id, enrollment_id, period, due_date, base_amount,
  discount_amount, final_amount, status, notified_at, paid_amount,
  refunded_amount, payment_count
)
select 'M056-R6', r.id, r.enrollment_id, r.period, r.due_date, r.base_amount,
       r.discount_amount, r.final_amount, r.status, r.notified_at,
       r.paid_amount, r.refunded_amount,
       (select count(*) from public.payments p where p.fee_record_id = r.id)
  from public.fee_records r
 where not exists (
   select 1 from public._migration_056_fee_cycle_snapshot s
    where s.run_id = 'M056-R6' and s.record_id = r.id
 );

alter table public._migration_056_fee_cycle_snapshot enable row level security;
alter table public._migration_056_fee_cycle_snapshot force row level security;
revoke all on table public._migration_056_fee_cycle_snapshot from public, anon, authenticated;

-- ===========================================================================
-- 3. Expand fee_records
-- ===========================================================================
alter table public.fee_records
  add column if not exists cycle_no integer;
alter table public.fee_records
  add column if not exists base_due_date date;
alter table public.fee_records
  add column if not exists adjusted_due_date date;
alter table public.fee_records
  add column if not exists coverage_start date;
alter table public.fee_records
  add column if not exists coverage_end date;
alter table public.fee_records
  add column if not exists origin text;
alter table public.fee_records
  add column if not exists superseded_by_record_id uuid;
alter table public.fee_records
  add column if not exists superseded_at timestamptz;
alter table public.fee_records
  add column if not exists voided_at timestamptz;

-- ===========================================================================
-- 4. Backfill legacy cycles 1..n (never cycle 0), deterministic evidence
-- ===========================================================================
do $$
declare
  rec record;
  cycle integer;
  current_enrollment uuid;
  coverage_end_value date;
begin
  for rec in
    select fr.id, fr.enrollment_id, fr.due_date, fr.period, fr.created_at,
           e.enrollment_date as enrollment_date,
           fr.class_type_snapshot,
           fr.billing_cycle_weeks_snapshot,
           fr.billing_cycle_months_snapshot
      from public.fee_records fr
      join public.enrollments e on e.id = fr.enrollment_id
     where fr.cycle_no is null
     order by fr.enrollment_id asc,
              (fr.due_date is null) asc,
              fr.due_date asc,
              fr.created_at asc,
              fr.id asc
  loop
    if current_enrollment is distinct from rec.enrollment_id then
      current_enrollment := rec.enrollment_id;
      cycle := 1;
    end if;

    if rec.class_type_snapshot = 'COURSE' then
      coverage_end_value := rec.due_date + (rec.billing_cycle_weeks_snapshot * 7);
    else
      coverage_end_value := (rec.due_date + interval '1 month')::date;
    end if;

    update public.fee_records
       set cycle_no = cycle,
           base_due_date = rec.due_date,
           adjusted_due_date = rec.due_date,
           coverage_start = rec.due_date,
           coverage_end = coverage_end_value,
           origin = 'LEGACY_BACKFILL'
     where id = rec.id;
    cycle := cycle + 1;
  end loop;
end;
$$;

-- ===========================================================================
-- 5. Supporting + canonical unique index (old period unique stays until D19)
-- ===========================================================================
drop index if exists ux_fee_records_enrollment_cycle;
create unique index ux_fee_records_enrollment_cycle
  on public.fee_records (enrollment_id, cycle_no)
  where cycle_no is not null;

drop index if exists ix_fee_records_enrollment_cycle_due;
create index ix_fee_records_enrollment_cycle_due
  on public.fee_records (enrollment_id, cycle_no, adjusted_due_date, status);

-- ===========================================================================
-- 6. Parity + acceptance
-- ===========================================================================
do $$
declare
  snapshot_count bigint;
  live_count bigint;
  sum_mismatch bigint;
  status_mismatch bigint;
  payment_mismatch bigint;
  cycle_gap bigint;
  cycle0_count bigint;
begin
  select count(*) into snapshot_count from public._migration_056_fee_cycle_snapshot where run_id = 'M056-R6';
  select count(*) into live_count from public.fee_records;
  select count(*) into sum_mismatch
    from public._migration_056_fee_cycle_snapshot s
    join public.fee_records r on r.id = s.record_id
   where s.base_amount <> r.base_amount
      or s.discount_amount <> r.discount_amount
      or s.final_amount <> r.final_amount
      or coalesce(s.paid_amount, 0) <> coalesce(r.paid_amount, 0)
      or s.refunded_amount <> r.refunded_amount
      or s.status <> r.status
      or s.notified_at is distinct from r.notified_at;
  select count(*) into payment_mismatch
    from public._migration_056_fee_cycle_snapshot s
    join public.fee_records r on r.id = s.record_id
   where s.payment_count <> (
     select count(*) from public.payments p where p.fee_record_id = r.id
   );
  select count(*) into cycle_gap
    from (
      select enrollment_id, cycle_no,
             lag(cycle_no) over (partition by enrollment_id order by cycle_no) as prev
        from public.fee_records where cycle_no is not null
    ) x
   where x.prev is not null and x.cycle_no <> x.prev + 1;
  select count(*) into cycle0_count
    from public.fee_records where cycle_no = 0;

  if snapshot_count <> live_count then
    raise exception 'M056 parity failed: snapshot=% live=%', snapshot_count, live_count;
  end if;
  if sum_mismatch > 0 or payment_mismatch > 0 then
    raise exception 'M056 parity failed: money=% payments=%', sum_mismatch, payment_mismatch;
  end if;
  if cycle_gap > 0 then
    raise exception 'M056 parity failed: cycle numbering has gaps';
  end if;
  if cycle0_count > 0 then
    raise exception 'M056 parity failed: legacy cycle 0 must never exist';
  end if;
  raise notice 'M056 acceptance OK: records=% parity-ok cycle0=% gap=%',
    live_count, cycle0_count, cycle_gap;
end;
$$;

commit;
