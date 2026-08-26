-- R10.0 — preserve the bank account used for every payment/refund.
--
-- Manual bank transfers must be attributable to the receiving account chosen
-- by the manager. Pay2S callbacks use the same field so the automatic and
-- manual ledgers have one consistent provenance model. Existing ledger rows
-- are retained with a null account (legacy data); all new API writes populate
-- the immutable snapshots below.

begin;

alter table public.payments
  add column if not exists settlement_account_id uuid
    references public.workspace_payment_accounts(id) on delete set null,
  add column if not exists settlement_bank_code_snapshot text,
  add column if not exists settlement_bank_name_snapshot text,
  add column if not exists settlement_account_number_snapshot text,
  add column if not exists settlement_account_name_snapshot text;

alter table public.payment_requests
  add column if not exists settlement_account_id uuid
    references public.workspace_payment_accounts(id) on delete set null;

create index if not exists payments_settlement_account_idx
  on public.payments (workspace_id, settlement_account_id, payment_date desc)
  where settlement_account_id is not null;

create index if not exists payment_requests_settlement_account_idx
  on public.payment_requests (workspace_id, settlement_account_id, created_at desc)
  where settlement_account_id is not null;

alter table public.payments
  drop constraint if exists payments_settlement_snapshot_shape_check;
alter table public.payments
  add constraint payments_settlement_snapshot_shape_check
  check (
    (settlement_account_id is null
      and settlement_bank_code_snapshot is null
      and settlement_bank_name_snapshot is null
      and settlement_account_number_snapshot is null
      and settlement_account_name_snapshot is null)
    or
    (settlement_account_id is not null
      and char_length(btrim(coalesce(settlement_bank_code_snapshot, ''))) between 2 and 40
      and char_length(btrim(coalesce(settlement_bank_name_snapshot, ''))) between 2 and 160
      and char_length(btrim(coalesce(settlement_account_number_snapshot, ''))) between 4 and 30
      and char_length(btrim(coalesce(settlement_account_name_snapshot, ''))) between 2 and 160)
  );

alter table public.payments
  drop constraint if exists payments_cash_without_settlement_account_check;
alter table public.payments
  add constraint payments_cash_without_settlement_account_check
  check (payment_method <> 'cash' or settlement_account_id is null);

alter table public.payments enable row level security;
alter table public.payments force row level security;
alter table public.payment_requests enable row level security;
alter table public.payment_requests force row level security;

commit;
