-- R6-D05 056 negative cleanup: remove ambiguous rows, restore period unique.
\set ON_ERROR_STOP on

delete from public.fee_records
 where enrollment_id = '70000000-0000-0000-0000-000000000011'
   and period = '2027-01';

create unique index if not exists ux_fee_records_enrollment_period
  on public.fee_records (enrollment_id, period);
