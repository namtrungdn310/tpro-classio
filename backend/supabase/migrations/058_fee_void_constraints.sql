-- R6-D06 — fee VOID/SUPERSEDED constraint relax (uses enum values added by 057).
--
-- The strict UNPAID/PAID payment-state shape only applies to live obligations;
-- VOID/SUPERSEDED are terminal lifecycle markers with voided_at evidence.
-- Forward-only expand phase.

begin;

alter table public.fee_records
  drop constraint if exists fee_records_payment_state_check;

-- Giữ nguyên semantics 031 (direct payment không bắt buộc notified_at);
-- bổ sung nhánh terminal VOID/SUPERSEDED.
alter table public.fee_records
  add constraint fee_records_payment_state_check
    check (
      status = 'VOID'
      or status = 'SUPERSEDED'
      or (
        status = 'UNPAID'
        and paid_amount is null
        and paid_date is null
      )
      or (
        status = 'PAID'
        and paid_amount = final_amount
        and paid_date is not null
      )
    ) not valid;

alter table public.fee_records
  drop constraint if exists fee_records_void_metadata_check;
alter table public.fee_records
  add constraint fee_records_void_metadata_check
    check (
      status not in ('VOID', 'SUPERSEDED')
      or (voided_at is not null)
    ) not valid;

-- Fee operation actions mở rộng cho VOID/SUPERSEDED lifecycle events.
alter table public.fee_operations
  drop constraint if exists fee_operations_action_check;
alter table public.fee_operations
  add constraint fee_operations_action_check
    check (
      action = any (array[
        'notify', 'unnotify', 'payment', 'payment_reversal', 'refund',
        'refund_reversal', 'sync', 'sync_void', 'supersede', 'template_update'
      ])
    ) not valid;

-- Validate (acceptance): mọi dữ liệu hiện có phải thoả shape mới; nếu có vi
-- phạm, migration fail nguyên khối — không đoán.
alter table public.fee_records validate constraint fee_records_payment_state_check;
alter table public.fee_records validate constraint fee_records_void_metadata_check;
alter table public.fee_operations validate constraint fee_operations_action_check;

commit;
