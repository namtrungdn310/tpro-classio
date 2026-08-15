-- R6-D05 056 rollback (compatibility): drop the new columns/indexes; abort
-- when cycle evidence exists unless FORCE_DROP_EVIDENCE=1 (forward-fix).
\set ON_ERROR_STOP on

do $$
begin
  if current_setting('FORCE_DROP_EVIDENCE', true) <> '1'
     and exists (select 1 from public._migration_056_fee_cycle_snapshot) then
    raise exception 'M056 rollback abort: cycle evidence exists; use forward-fix instead';
  end if;
end;
$$;

drop index if exists public.ux_fee_records_enrollment_cycle;
drop index if exists public.ix_fee_records_enrollment_cycle_due;
drop table if exists public._migration_056_fee_cycle_snapshot;
alter table public.fee_records drop column if exists voided_at;
alter table public.fee_records drop column if exists superseded_at;
alter table public.fee_records drop column if exists superseded_by_record_id;
alter table public.fee_records drop column if exists origin;
alter table public.fee_records drop column if exists coverage_end;
alter table public.fee_records drop column if exists coverage_start;
alter table public.fee_records drop column if exists adjusted_due_date;
alter table public.fee_records drop column if exists base_due_date;
alter table public.fee_records drop column if exists cycle_no;
