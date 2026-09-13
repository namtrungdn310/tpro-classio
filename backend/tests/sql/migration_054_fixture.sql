-- R6-D02 upgrade fixture: legacy classes that existed under the old rule —
-- one exact (divisible) course class and one legacy monthly class.
\set ON_ERROR_STOP on

insert into public.classes (
  id, name, type, base_fee, billing_cycle_months, billing_cycle_weeks,
  identity_scheme, is_active, start_date, end_date
) values (
  '20000000-0000-0000-0000-000000000054', 'M054 LEGACY COURSE', 'COURSE', 750000, 1, 3,
  'LEGACY', true, date '2026-08-13', date '2026-09-03'
), (
  '20000000-0000-0000-0000-000000000055', 'M054 LEGACY MONTHLY', 'MONTHLY', 900000, 1, null,
  'LEGACY', true, date '2026-08-01', date '2026-12-31'
);
