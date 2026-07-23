-- Add auditable partial/full tuition refunds without rewriting payment history.
-- Refunds remain separate from payment reversals: a refunded fee stays PAID,
-- while fee_records.refunded_amount is the fast current-state projection.
begin;

do $$
begin
  create type public.payment_entry_type as enum (
    'payment',
    'payment_reversal',
    'refund',
    'refund_reversal'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
declare
  actual_labels text[];
begin
  select array_agg(e.enumlabel order by e.enumsortorder)
  into actual_labels
  from pg_catalog.pg_enum e
  join pg_catalog.pg_type t on t.oid = e.enumtypid
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and t.typname = 'payment_entry_type';

  if actual_labels is distinct from array[
    'payment', 'payment_reversal', 'refund', 'refund_reversal'
  ]::text[] then
    raise exception 'payment_entry_type has unexpected labels: %', actual_labels;
  end if;
end
$$;

alter table public.payments
  add column if not exists entry_type public.payment_entry_type,
  add column if not exists related_payment_id uuid,
  add column if not exists idempotency_key uuid;

-- Migration 023 made the legacy ledger append-only. Temporarily remove only
-- the row trigger inside this transaction so the one-time entry-type backfill
-- can run; it is recreated with the expanded immutable field set below.
drop trigger if exists payments_append_only_row on public.payments;

update public.payments
set entry_type = case
  when amount < 0 or note like 'Hoàn tác ghi nhận học phí%'
    then 'payment_reversal'::public.payment_entry_type
  else 'payment'::public.payment_entry_type
end
where entry_type is null;

alter table public.payments
  alter column entry_type set default 'payment'::public.payment_entry_type,
  alter column entry_type set not null,
  drop constraint if exists payments_related_payment_id_fkey,
  drop constraint if exists payments_created_by_fkey,
  drop constraint if exists payments_entry_shape_check;

alter table public.payments
  add constraint payments_related_payment_id_fkey
    foreign key (related_payment_id)
    references public.payments(id)
    on delete restrict,
  add constraint payments_created_by_fkey
    foreign key (created_by)
    references public.profiles(id)
    on delete set null,
  add constraint payments_entry_shape_check
    check (
      (
        entry_type = 'payment'
        and amount >= 0
        and related_payment_id is null
        and idempotency_key is null
      )
      or (
        entry_type = 'payment_reversal'
        and amount <= 0
        and idempotency_key is null
      )
      or (
        entry_type = 'refund'
        and amount < 0
        and related_payment_id is not null
        and idempotency_key is not null
        and note is not null
        and char_length(btrim(note)) between 3 and 500
      )
      or (
        entry_type = 'refund_reversal'
        and amount > 0
        and related_payment_id is not null
        and idempotency_key is not null
        and note is not null
        and char_length(btrim(note)) between 3 and 500
      )
    ) not valid;

alter table public.payments
  validate constraint payments_entry_shape_check;

alter table public.fee_records
  add column if not exists refunded_amount numeric(12,0) not null default 0,
  drop constraint if exists fee_records_refund_state_check;

drop trigger if exists fee_records_protect_refund_projection
  on public.fee_records;

with refund_totals as (
  select
    fee_record_id,
    coalesce(sum(
      case
        when entry_type = 'refund' then abs(amount)
        when entry_type = 'refund_reversal' then -amount
        else 0
      end
    ), 0) as amount
  from public.payments
  group by fee_record_id
)
update public.fee_records fee
set refunded_amount = refund_totals.amount
from refund_totals
where refund_totals.fee_record_id = fee.id
  and fee.refunded_amount is distinct from refund_totals.amount;

alter table public.fee_records
  add constraint fee_records_refund_state_check
    check (
      refunded_amount >= 0
      and (
        refunded_amount = 0
        or (
          status = 'PAID'
          and paid_amount is not null
          and refunded_amount <= paid_amount
        )
      )
    ) not valid;

alter table public.fee_records
  validate constraint fee_records_refund_state_check;

create unique index if not exists ux_payments_refund_request_record
  on public.payments (idempotency_key, fee_record_id)
  where idempotency_key is not null;

create unique index if not exists ux_payments_refund_reversal_related
  on public.payments (related_payment_id)
  where entry_type = 'refund_reversal';

create unique index if not exists ux_payments_payment_reversal_related
  on public.payments (related_payment_id)
  where entry_type = 'payment_reversal'
    and related_payment_id is not null;

create index if not exists idx_payments_related_payment
  on public.payments (related_payment_id)
  where related_payment_id is not null;

create index if not exists idx_payments_fee_entry_created
  on public.payments (fee_record_id, entry_type, created_at desc, id desc);

create index if not exists idx_fee_records_period_refunded
  on public.fee_records (period, refunded_amount)
  where refunded_amount > 0;

create or replace function public.validate_payment_ledger_entry()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  source_entry public.payments%rowtype;
begin
  if new.entry_type = 'payment' then
    if new.amount < 0
      or new.related_payment_id is not null
      or new.idempotency_key is not null then
      raise exception 'A payment must be a positive original ledger entry'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.related_payment_id is null then
    raise exception 'A reversal or refund must reference its source entry'
      using errcode = '23514';
  end if;

  select *
  into source_entry
  from public.payments
  where id = new.related_payment_id
    and fee_record_id = new.fee_record_id;

  if not found then
    raise exception 'The referenced ledger entry does not belong to this fee record'
      using errcode = '23514';
  end if;

  if new.entry_type = 'payment_reversal' then
    if new.amount > 0
      or new.idempotency_key is not null
      or source_entry.entry_type <> 'payment'::public.payment_entry_type
      or abs(new.amount) <> source_entry.amount then
      raise exception 'A payment reversal must exactly reverse one payment'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.created_by is null then
    raise exception 'Refund ledger entries require an actor'
      using errcode = '23514';
  end if;
  if new.idempotency_key is null
    or new.note is null
    or char_length(btrim(new.note)) not between 3 and 500 then
    raise exception 'Refund ledger entries require an idempotency key and reason'
      using errcode = '23514';
  end if;

  if new.entry_type = 'refund' then
    if new.amount >= 0
      or source_entry.entry_type <> 'payment'::public.payment_entry_type then
      raise exception 'A refund must reference an original payment'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.entry_type = 'refund_reversal' then
    if new.amount <= 0
      or source_entry.entry_type <> 'refund'::public.payment_entry_type
      or new.amount <> abs(source_entry.amount) then
      raise exception 'A refund reversal must exactly reverse one refund'
        using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception 'Unsupported payment ledger entry type'
    using errcode = '23514';
end;
$$;

revoke all on function public.validate_payment_ledger_entry()
  from public, anon, authenticated;

drop trigger if exists payments_validate_ledger_entry on public.payments;
create trigger payments_validate_ledger_entry
before insert on public.payments
for each row execute function public.validate_payment_ledger_entry();

create or replace function public.apply_fee_refund_projection()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  related_type public.payment_entry_type;
  related_amount numeric(12,0);
begin
  if new.entry_type not in ('refund', 'refund_reversal') then
    return new;
  end if;

  select entry_type, amount
  into related_type, related_amount
  from public.payments
  where id = new.related_payment_id
    and fee_record_id = new.fee_record_id;

  if new.entry_type = 'refund' then
    if related_type is distinct from 'payment'::public.payment_entry_type then
      raise exception 'Refund must reference a payment from the same fee record'
        using errcode = '23514';
    end if;

    update public.fee_records
    set refunded_amount = refunded_amount + abs(new.amount)
    where id = new.fee_record_id
      and status = 'PAID'
      and paid_amount is not null
      and refunded_amount + abs(new.amount) <= paid_amount;

    if not found then
      raise exception 'Refund exceeds the refundable paid amount'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if related_type is distinct from 'refund'::public.payment_entry_type
    or new.amount <> abs(related_amount) then
    raise exception 'Refund reversal must exactly reference a refund'
      using errcode = '23514';
  end if;

  update public.fee_records
  set refunded_amount = refunded_amount - new.amount
  where id = new.fee_record_id
    and refunded_amount >= new.amount;

  if not found then
    raise exception 'Refund reversal does not match the refund projection'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.apply_fee_refund_projection()
  from public, anon, authenticated;

drop trigger if exists payments_apply_refund_projection on public.payments;
create trigger payments_apply_refund_projection
after insert on public.payments
for each row execute function public.apply_fee_refund_projection();

create or replace function public.protect_fee_refund_projection()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.refunded_amount is distinct from old.refunded_amount
    and pg_trigger_depth() < 2 then
    raise exception 'refunded_amount is a ledger projection and cannot be edited directly'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_fee_refund_projection()
  from public, anon, authenticated;

drop trigger if exists fee_records_protect_refund_projection on public.fee_records;
create trigger fee_records_protect_refund_projection
before update of refunded_amount on public.fee_records
for each row execute function public.protect_fee_refund_projection();

create or replace function public.protect_payment_ledger_entry()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
    and new.id is not distinct from old.id
    and new.fee_record_id is not distinct from old.fee_record_id
    and new.amount is not distinct from old.amount
    and new.payment_date is not distinct from old.payment_date
    and new.payment_method is not distinct from old.payment_method
    and new.entry_type is not distinct from old.entry_type
    and new.related_payment_id is not distinct from old.related_payment_id
    and new.idempotency_key is not distinct from old.idempotency_key
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

create trigger payments_append_only_row
before update or delete on public.payments
for each row execute function public.protect_payment_ledger_entry();

alter table public.payments enable row level security;
alter table public.payments force row level security;
revoke all privileges on table public.payments
  from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from public.fee_records fee
    left join (
      select
        fee_record_id,
        coalesce(sum(
          case
            when entry_type = 'refund' then abs(amount)
            when entry_type = 'refund_reversal' then -amount
            else 0
          end
        ), 0) as refunded_amount
      from public.payments
      group by fee_record_id
    ) ledger on ledger.fee_record_id = fee.id
    where fee.refunded_amount is distinct from coalesce(ledger.refunded_amount, 0)
  ) then
    raise exception 'fee refund projection does not reconcile with the payment ledger';
  end if;
end
$$;

commit;
