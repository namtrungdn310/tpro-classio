-- Durable exact financial plans; no fee generation or historical backfill.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.start_date_change_commands
  add column if not exists execution_plan jsonb;
alter table public.start_date_change_commands
  drop constraint if exists start_date_change_commands_operation_kind_check;
alter table public.start_date_change_commands
  add constraint start_date_change_commands_operation_kind_check check (
    operation_kind in ('LEGACY_DATE_CHANGE', 'ADMISSION_DATE_CHANGE',
      'CLASS_ADMISSION_DATE_CHANGE', 'BILLING_SCHEDULE_CHANGE', 'FEE_DUE_DATE_CHANGE')
  ) not valid;
alter table public.start_date_change_commands
  validate constraint start_date_change_commands_operation_kind_check;

alter table public.fee_records
  add column if not exists admission_date_snapshot date,
  add column if not exists billing_anchor_date_snapshot date,
  add column if not exists collection_due_offset_days integer not null default 0;

alter table public.billing_anchor_revisions
  drop constraint if exists billing_anchor_revisions_change_kind_check;
alter table public.billing_anchor_revisions
  add constraint billing_anchor_revisions_change_kind_check check (
    change_kind in ('INITIAL', 'INITIAL_BACKDATED', 'ENROLLMENT_DATE_CHANGE',
      'PACKAGE_DURATION_CHANGE', 'MEMBERSHIP_TRANSFER', 'CLASS_START_DATE_CHANGE',
      'STUDENT_START_DATE_CHANGE', 'BILLING_SCHEDULE_CHANGE')
  ) not valid;
alter table public.billing_anchor_revisions
  validate constraint billing_anchor_revisions_change_kind_check;

alter table public.fee_operations drop constraint if exists fee_operations_action_check;
alter table public.fee_operations add constraint fee_operations_action_check check (
  action = any (array['notify', 'unnotify', 'payment', 'payment_reversal', 'refund',
    'refund_reversal', 'sync', 'sync_void', 'supersede', 'template_update',
    'anchor_recalculation', 'billing_cycle_change', 'due_date_change'])
) not valid;
alter table public.fee_operations validate constraint fee_operations_action_check;

commit;
