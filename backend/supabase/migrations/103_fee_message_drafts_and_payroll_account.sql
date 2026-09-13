-- Persist per-fee Zalo drafts and the bank account used for payroll payouts.
-- Financial snapshots remain readable if an account is archived or deleted.

begin;

alter table public.fee_records
  add column if not exists reminder_message_draft text,
  add column if not exists received_message_draft text;

alter table public.fee_records
  drop constraint if exists fee_records_message_drafts_length_check;
alter table public.fee_records
  add constraint fee_records_message_drafts_length_check check (
    (reminder_message_draft is null
      or char_length(btrim(reminder_message_draft)) between 1 and 2000)
    and
    (received_message_draft is null
      or char_length(btrim(received_message_draft)) between 1 and 2000)
  ) not valid;
alter table public.fee_records
  validate constraint fee_records_message_drafts_length_check;

alter table public.staff_payroll_settlements
  add column if not exists settlement_account_id uuid,
  add column if not exists settlement_bank_code_snapshot text,
  add column if not exists settlement_bank_name_snapshot text,
  add column if not exists settlement_account_number_snapshot text,
  add column if not exists settlement_account_name_snapshot text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.staff_payroll_settlements'::regclass
       and conname = 'staff_payroll_settlements_account_fkey'
  ) then
    alter table public.staff_payroll_settlements
      add constraint staff_payroll_settlements_account_fkey
      foreign key (settlement_account_id)
      references public.workspace_payment_accounts(id)
      on delete set null;
  end if;
end $$;

create index if not exists staff_payroll_settlements_account_idx
  on public.staff_payroll_settlements (workspace_id, settlement_account_id, created_at desc)
  where settlement_account_id is not null;

revoke all on table public.fee_records from public, anon, authenticated;
revoke all on table public.staff_payroll_settlements from public, anon, authenticated;

commit;
