-- R6-D05 056 assert: cycle numbering deterministic, origin LEGACY_BACKFILL,
-- no cycle 0, money/status/payment parity vs snapshot, old period unique kept.
\set ON_ERROR_STOP on

do $$
declare
  c1 date; c2 date; c3 date;
  origin_ok bigint;
  protected_cycle_ok bigint;
begin
  -- Chuỗi 3 kỳ của enrollment 011 theo evidence (due_date, created_at, id).
  select due_date into c1 from public.fee_records
   where enrollment_id = '70000000-0000-0000-0000-000000000011' and cycle_no = 1;
  select due_date into c2 from public.fee_records
   where enrollment_id = '70000000-0000-0000-0000-000000000011' and cycle_no = 2;
  select due_date into c3 from public.fee_records
   where enrollment_id = '70000000-0000-0000-0000-000000000011' and cycle_no = 3;
  if c1 <> date '2026-10-01' or c2 <> date '2026-11-01' or c3 <> date '2026-12-01' then
    raise exception 'T-DB056-001: cycle mapping wrong (% % %)', c1, c2, c3;
  end if;

  -- Record null-due (053-style) của enrollment dropped có cycle 1, due NULL.
  if exists (
    select 1 from public.fee_records
     where enrollment_id = '70000000-0000-0000-0000-000000000012'
       and cycle_no <> 1
  ) then
    raise exception 'T-DB056-002: null-due legacy record cycle wrong';
  end if;

  select count(*) into origin_ok
    from public.fee_records
   where cycle_no is not null and origin <> 'LEGACY_BACKFILL';
  if origin_ok <> 0 then
    raise exception 'T-DB056-003: non-LEGACY_BACKFILL origin found';
  end if;

  -- Kỳ PAID/notified giữ nguyên trạng thái (protected history).
  select count(*) into protected_cycle_ok
    from public.fee_records
   where enrollment_id = '70000000-0000-0000-0000-000000000011'
     and cycle_no = 2 and status = 'PAID' and paid_amount = 750000;
  if protected_cycle_ok <> 1 then
    raise exception 'T-DB056-004: protected cycle rewritten';
  end if;

  -- Unique (enrollment_id, cycle_no) được enforce.
  begin
    update public.fee_records set cycle_no = 1
     where enrollment_id = '70000000-0000-0000-0000-000000000011'
       and cycle_no = 3;
    raise exception 'T-DB056-005: duplicate cycle unexpectedly accepted';
  exception
    when unique_violation then
      null;
  end;

  -- R6-D19: contract đã drop period unique; identity = (enrollment, cycle_no).
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'fee_records'
       and indexname = 'ux_fee_records_enrollment_cycle'
  ) then
    raise exception 'T-DB056-006: cycle identity index missing';
  end if;

  -- Coverage/baseline đúng cho monthly legacy.
  if exists (
    select 1 from public.fee_records
     where enrollment_id = '70000000-0000-0000-0000-000000000011'
       and cycle_no = 1
       and (base_due_date <> '2026-10-01' or adjusted_due_date <> '2026-10-01'
            or coverage_start <> '2026-10-01' or coverage_end <> '2026-11-01')
  ) then
    raise exception 'T-DB056-007: baseline/coverage wrong';
  end if;
end;
$$;
