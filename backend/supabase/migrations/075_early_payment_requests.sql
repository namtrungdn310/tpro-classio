-- TPRO Classio — 075_early_payment_requests.sql
--
-- Early payment is an explicit management action.  It must not be inferred
-- from a QR view, a copied message, or a webhook delivery.  This migration is
-- forward-only: the existing fee/payment ledger and the 068 provider scaffold
-- remain intact and all corrections continue to be append-only.

begin;

alter table public.payment_requests
  add column if not exists request_id uuid,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists sent_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists early_payment boolean not null default false;

update public.payment_requests
set request_id = id
where request_id is null;

alter table public.payment_requests
  alter column request_id set default gen_random_uuid(),
  alter column request_id set not null;

create unique index if not exists payment_requests_request_id_uniq
  on public.payment_requests (request_id);

alter table public.payment_requests
  drop constraint if exists payment_requests_status_check;
alter table public.payment_requests
  add constraint payment_requests_status_check
    check (status in ('OPEN', 'EXPIRED', 'REVOKED', 'PAID', 'FAILED', 'REVIEW'));

create table if not exists public.payment_request_items (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null
    references public.payment_requests(id) on delete restrict,
  fee_record_id uuid not null
    references public.fee_records(id) on delete restrict,
  enrollment_id uuid not null
    references public.enrollments(id) on delete restrict,
  student_code_snapshot text not null,
  class_name_snapshot text not null,
  cycle_no smallint not null,
  base_due_date date,
  adjusted_due_date date,
  expected_amount numeric(12,0) not null check (expected_amount > 0),
  created_at timestamptz not null default now(),
  constraint payment_request_items_request_fee_uniq
    unique (payment_request_id, fee_record_id)
);

-- Existing scaffold rows must be reviewable before we tighten the snapshot
-- contract.  Abort with an actionable message instead of allowing a partial
-- backfill or silently inventing a student code/reference.
do $$
begin
  if exists (
    select 1
    from public.payment_requests
    where student_code_snapshot !~ '^TP[0-9]{9}$'
       or payment_reference !~ '^TP[0-9]{9}P[0-9A-HJKMNP-TV-Z]{8}$'
  ) then
    raise exception
      '075 preflight failed: existing payment request has invalid student code or reference; repair/audit rows before retrying'
      using errcode = '23514';
  end if;
end;
$$;

-- A request is a snapshot, not a free-form amount.  Keep every item tied to
-- the same student/enrollment and reject malformed references before the
-- application layer can see them.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_request_items'::regclass
      and conname = 'payment_request_items_code_check'
  ) then
    alter table public.payment_request_items
      add constraint payment_request_items_code_check
      check (student_code_snapshot ~ '^TP[0-9]{9}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_request_items'::regclass
      and conname = 'payment_request_items_dates_check'
  ) then
    alter table public.payment_request_items
      add constraint payment_request_items_dates_check
      check (
        adjusted_due_date is null
        or base_due_date is null
        or adjusted_due_date >= base_due_date
      );
  end if;
end;
$$;

-- Backfill a canonical item for requests created by the original scaffold.
insert into public.payment_request_items (
  payment_request_id,
  fee_record_id,
  enrollment_id,
  student_code_snapshot,
  class_name_snapshot,
  cycle_no,
  base_due_date,
  adjusted_due_date,
  expected_amount
)
select
  request.id,
  request.fee_record_id,
  request.enrollment_id,
  request.student_code_snapshot,
  coalesce(fee.class_name_snapshot, 'Lớp'),
  coalesce(fee.cycle_no, 0),
  fee.base_due_date,
  fee.adjusted_due_date,
  request.expected_amount
from public.payment_requests request
join public.fee_records fee on fee.id = request.fee_record_id
where not exists (
  select 1
  from public.payment_request_items item
  where item.payment_request_id = request.id
    and item.fee_record_id = request.fee_record_id
);

alter table public.payment_request_events
  drop constraint if exists payment_request_events_event_type_check;
alter table public.payment_request_events
  add constraint payment_request_events_event_type_check
    check (event_type in (
      'CREATED', 'QR_SENT', 'EXPIRED', 'REVOKED', 'PAID', 'FAILED',
      'REVIEWED'
    ));

alter table public.payments
  add column if not exists payment_origin text not null default 'manual',
  add column if not exists payment_request_id uuid
    references public.payment_requests(id) on delete set null,
  add column if not exists provider_transaction_id text;

-- A payment request can be prepared before its due date, but it must never
-- represent a stale or zero obligation.  The request header remains mutable
-- only through an audited status transition; item snapshots are immutable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_requests'::regclass
      and conname = 'payment_requests_reference_check'
  ) then
    alter table public.payment_requests
      add constraint payment_requests_reference_check
      check (payment_reference ~ '^TP[0-9]{9}P[0-9A-HJKMNP-TV-Z]{8}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_requests'::regclass
      and conname = 'payment_requests_amount_check'
  ) then
    alter table public.payment_requests
      add constraint payment_requests_amount_check
      check (expected_amount > 0);
  end if;
end;
$$;

alter table public.payments
  drop constraint if exists payments_payment_origin_check;
alter table public.payments
  add constraint payments_payment_origin_check
    check (payment_origin in ('manual', 'manual_early', 'pay2s'));

create unique index if not exists payments_provider_transaction_uniq
  on public.payments (provider_transaction_id)
  where provider_transaction_id is not null;

-- Keep the actor-anonymisation exception while making all new provenance
-- fields immutable.  Financial corrections remain new ledger rows.
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
    and new.payment_origin is not distinct from old.payment_origin
    and new.payment_request_id is not distinct from old.payment_request_id
    and new.provider_transaction_id is not distinct from old.provider_transaction_id
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

alter table public.payment_request_items enable row level security;
alter table public.payment_request_items force row level security;
revoke all on table public.payment_request_items from public, anon, authenticated;

drop trigger if exists trg_payment_request_items_append_only
  on public.payment_request_items;
create trigger trg_payment_request_items_append_only
before update or delete on public.payment_request_items
for each row execute function public.block_payment_scaffold_mutation();

commit;
