-- R6-D05 056 negative fixture: simulate a legacy state WITHOUT the period
-- unique so two records share the same due evidence — 056 must abort and
-- never guess cycle numbers.
\set ON_ERROR_STOP on

drop index if exists public.ux_fee_records_enrollment_period;

insert into public.fee_records (
  enrollment_id, period, due_date, base_amount, discount_amount, status,
  cycle_no, origin, coverage_start, coverage_end, base_due_date,
  adjusted_due_date, student_name_snapshot, class_name_snapshot,
  class_type_snapshot, billing_cycle_months_snapshot
)
values
  ('70000000-0000-0000-0000-000000000011', '2027-01', '2027-01-01', 750000, 0, 'UNPAID',
   99, 'LEGACY_BACKFILL', '2027-01-01', '2027-02-01', '2027-01-01', '2027-01-01',
   'M056 Student X', 'Lớp M053 A', 'MONTHLY', 1),
  ('70000000-0000-0000-0000-000000000011', '2027-01', '2027-01-01', 750000, 0, 'UNPAID',
   100, 'LEGACY_BACKFILL', '2027-01-01', '2027-02-01', '2027-01-01', '2027-01-01',
   'M056 Student X', 'Lớp M053 A', 'MONTHLY', 1);
