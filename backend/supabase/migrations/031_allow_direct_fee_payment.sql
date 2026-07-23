-- A parent may pay before the admin records a Zalo notification. Keep that
-- distinction truthful: payment data is required for PAID rows, while the
-- notification fields may remain entirely null. The separate notification
-- constraint still prevents partial or malformed notification metadata.
begin;

alter table public.fee_records
  drop constraint if exists fee_records_payment_state_check;

alter table public.fee_records
  add constraint fee_records_payment_state_check
    check (
      (
        status = 'UNPAID'
        and paid_amount is null
        and paid_date is null
      )
      or
      (
        status = 'PAID'
        and paid_amount = final_amount
        and paid_date is not null
      )
    ) not valid;

alter table public.fee_records
  validate constraint fee_records_payment_state_check;

commit;
