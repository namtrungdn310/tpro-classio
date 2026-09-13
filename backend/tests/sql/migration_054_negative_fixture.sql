-- R6-D02 negative fixture: a legacy MONTHLY class below the new minimum end
-- date (start + 1 month + 1 day) must abort the migration preflight with
-- actionable IDs. A COURSE below-min row cannot exist under the old exact-
-- division trigger, so MONTHLY is the meaningful preflight abort case.
\set ON_ERROR_STOP on

insert into public.classes (
  id, name, type, base_fee, billing_cycle_months, billing_cycle_weeks,
  identity_scheme, is_active, start_date, end_date
) values (
  '20000000-0000-0000-0000-000000000056', 'M054 BELOW MIN', 'MONTHLY', 900000, 1, null,
  'LEGACY', true, date '2026-08-13', date '2026-08-14'
);
