-- Fee records are the current billing projection and payments are the audit
-- ledger. Viewer access remains available through the trusted FastAPI layer;
-- browser Data API access is removed so authorization, privacy redaction,
-- locking and state transitions cannot be bypassed.
begin;

drop policy if exists "students_select" on public.students;
drop policy if exists "enrollments_select" on public.enrollments;
drop policy if exists "fee_records_select" on public.fee_records;
drop policy if exists "payments_select" on public.payments;
drop policy if exists "fee_records_insert" on public.fee_records;
drop policy if exists "fee_records_update" on public.fee_records;
drop policy if exists "fee_records_delete" on public.fee_records;
drop policy if exists "payments_insert" on public.payments;
drop policy if exists "payments_update" on public.payments;
drop policy if exists "payments_delete" on public.payments;

revoke select, insert, update, delete, truncate
  on table public.students, public.enrollments
  from anon, authenticated;
revoke select, insert, update, delete, truncate
  on table public.fee_records
  from anon, authenticated;
revoke select, insert, update, delete, truncate
  on table public.payments
  from anon, authenticated;

-- Preserve the payment ledger independently from the current fee projection.
-- Existing PAID rows from older releases did not always have ledger entries;
-- backfill them once before making the ledger append-only.
update public.payments
set payment_method = 'bank_transfer'
where payment_method is null;

alter table public.payments
  alter column payment_method set default 'bank_transfer',
  alter column payment_method set not null,
  drop constraint if exists payments_fee_record_id_fkey;

alter table public.payments
  add constraint payments_fee_record_id_fkey
  foreign key (fee_record_id)
  references public.fee_records(id)
  on delete restrict;

insert into public.payments (
  fee_record_id,
  amount,
  payment_date,
  payment_method,
  note,
  created_by
)
select
  fr.id,
  coalesce(fr.paid_amount, fr.final_amount),
  coalesce(fr.paid_date, current_date),
  'bank_transfer'::payment_method,
  'Đối soát dữ liệu thanh toán lịch sử khi nâng cấp',
  null
from public.fee_records fr
where fr.status = 'PAID'
  and not exists (
    select 1
    from public.payments p
    where p.fee_record_id = fr.id
  );

do $$
begin
  if exists (
    select 1
    from public.fee_records fr
    left join (
      select fee_record_id, sum(amount) as net_amount
      from public.payments
      group by fee_record_id
    ) ledger on ledger.fee_record_id = fr.id
    where (
      fr.status = 'PAID'
      and coalesce(ledger.net_amount, 0) <> coalesce(fr.paid_amount, fr.final_amount)
    ) or (
      fr.status = 'UNPAID'
      and coalesce(ledger.net_amount, 0) <> 0
    )
  ) then
    raise exception 'Payment ledger does not reconcile with fee record state';
  end if;
end $$;

-- NOT VALID deliberately avoids blocking deployment if old data needs a
-- one-time cleanup. PostgreSQL still enforces these checks for every new row and
-- every row changed after this migration.
alter table public.fee_records
  drop constraint if exists fee_records_period_format_check,
  drop constraint if exists fee_records_amounts_check,
  drop constraint if exists fee_records_payment_state_check,
  drop constraint if exists fee_records_notification_state_check;

alter table public.fee_records
  add constraint fee_records_period_format_check
    check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') not valid,
  add constraint fee_records_amounts_check
    check (
      base_amount >= 0
      and discount_amount >= 0
      and discount_amount <= base_amount
      and final_amount >= 0
    ) not valid,
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
        and notified_at is not null
        and paid_amount = final_amount
        and paid_date is not null
      )
    ) not valid,
  add constraint fee_records_notification_state_check
    check (
      (
        notified_at is null
        and notification_channel is null
        and notification_message is null
      )
      or
      (
        notified_at is not null
        and notification_channel is not null
        and notification_channel in ('zalo_manual', 'zalo_copy')
        and notification_message is not null
        and char_length(btrim(notification_message)) between 1 and 2000
      )
    ) not valid;

-- Runtime responses are intentionally strict. Validate legacy rows during the
-- release gate so one malformed historical record cannot later break an entire
-- fee-period response.
alter table public.fee_records
  validate constraint fee_records_period_format_check,
  validate constraint fee_records_amounts_check,
  validate constraint fee_records_payment_state_check,
  validate constraint fee_records_notification_state_check;

-- Negative rows are valid audit-ledger corrections. Zero-value rows are also
-- retained because the current domain explicitly supports free/custom-fee-zero
-- enrollments and still needs an auditable state transition.
alter table public.payments
  drop constraint if exists payments_nonzero_amount_check;

create index if not exists idx_payments_fee_record_id
  on public.payments (fee_record_id);

create or replace function public.protect_payment_ledger_entry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Account deletion may anonymize only the actor reference. Every financial
  -- field remains immutable, and reversals are represented by a new row.
  if tg_op = 'UPDATE'
    and new.id is not distinct from old.id
    and new.fee_record_id is not distinct from old.fee_record_id
    and new.amount is not distinct from old.amount
    and new.payment_date is not distinct from old.payment_date
    and new.payment_method is not distinct from old.payment_method
    and new.note is not distinct from old.note
    and new.created_at is not distinct from old.created_at
    and old.created_by is not null
    and new.created_by is null then
    return new;
  end if;

  raise exception 'Payment ledger is append-only; create a reversal entry instead'
    using errcode = '55000';
end;
$$;

revoke all on function public.protect_payment_ledger_entry()
  from public, anon, authenticated;

drop trigger if exists payments_append_only_row on public.payments;
create trigger payments_append_only_row
before update or delete on public.payments
for each row execute function public.protect_payment_ledger_entry();

drop trigger if exists payments_append_only_truncate on public.payments;
create trigger payments_append_only_truncate
before truncate on public.payments
for each statement execute function public.protect_payment_ledger_entry();

commit;
