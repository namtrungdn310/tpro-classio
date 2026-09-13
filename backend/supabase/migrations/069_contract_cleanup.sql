-- R6-D19 — Contract migrations (forward-only; after per-domain parity proof).
--
-- 1. Drop old (enrollment_id, period) unique — cycle identity đã chứng minh
--    parity (D05/D06) và nhiều cycle cùng period là hợp lệ.
-- 2. Drop classes.operational_end_date — runtime đã retire (D03/D12).
-- 3. students.student_code SET NOT NULL + validate format check (D04 parity).
-- 4. fee_records.cycle_no SET NOT NULL (D05/D06 parity; generator luôn gán).

begin;

-- ===========================================================================
-- 1. Old period unique (parity proof: 056 acceptance + integration D05/D06)
-- ===========================================================================
drop index if exists public.ux_fee_records_enrollment_period;

-- ===========================================================================
-- 2. operational_end_date column
-- ===========================================================================
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'classes'
       and column_name = 'operational_end_date'
  ) then
    alter table public.classes drop column operational_end_date;
  end if;
end;
$$;

-- ===========================================================================
-- 3. student_code NOT NULL (parity: students = coded = registry)
-- ===========================================================================
do $$
declare
  uncoded bigint;
begin
  select count(*) into uncoded from public.students where student_code is null;
  if uncoded > 0 then
    raise exception 'M069 abort: % student(s) without a code; cannot set NOT NULL', uncoded;
  end if;
  alter table public.students
    validate constraint students_student_code_format_check;
  alter table public.students
    alter column student_code set not null;
end;
$$;

-- ===========================================================================
-- 4. fee_records.cycle_no NOT NULL (dates giữ nullable: legacy row có thể
--    không có due evidence — facts giữ nguyên, không đoán)
-- ===========================================================================
do $$
declare
  uncycled bigint;
begin
  select count(*) into uncycled from public.fee_records where cycle_no is null;
  if uncycled > 0 then
    raise exception 'M069 abort: % fee record(s) without cycle_no; cannot set NOT NULL', uncycled;
  end if;
  alter table public.fee_records
    alter column cycle_no set not null;
  alter table public.fee_records
    alter column origin set not null;
end;
$$;

-- ===========================================================================
-- Acceptance
-- ===========================================================================
do $$
begin
  if exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'fee_records'
       and indexname = 'ux_fee_records_enrollment_period'
  ) then
    raise exception 'M069 acceptance failed: old period unique still present';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'classes'
       and column_name = 'operational_end_date'
  ) then
    raise exception 'M069 acceptance failed: operational_end_date column still present';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'students'
       and column_name = 'student_code' and is_nullable = 'YES'
  ) then
    raise exception 'M069 acceptance failed: student_code still nullable';
  end if;
  raise notice 'M069 acceptance OK: contract drops applied';
end;
$$;

commit;
