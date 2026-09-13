-- R6-D17 — Payment automation scaffold (provider-neutral, feature OFF).
--
-- Kill-switches: PAYMENT_PROVIDER=disabled, WEBHOOK_INGRESS_ENABLED=false,
-- AUTO_POST_ENABLED=false. Tables scaffolded; runtime behavior gated in app.

begin;

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  fee_record_id uuid not null references public.fee_records(id) on delete restrict,
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  student_code_snapshot text not null,
  payment_reference text not null unique,
  expected_amount numeric(12,0) not null check (expected_amount > 0),
  currency text not null default 'VND',
  status text not null default 'OPEN'
    check (status in ('OPEN', 'EXPIRED', 'REVOKED', 'PAID', 'FAILED')),
  expires_at timestamptz,
  provider text not null default 'pay2s_v1',
  provider_metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create unique index payment_requests_open_fee_uniq
  on public.payment_requests (fee_record_id)
  where status = 'OPEN';

create table if not exists public.payment_request_events (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null
    references public.payment_requests(id) on delete restrict,
  event_type text not null check (event_type in ('CREATED', 'EXPIRED', 'REVOKED', 'PAID', 'FAILED')),
  old_status text,
  new_status text,
  actor_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_provider_deliveries (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  provider_transaction_id text,
  payload_hash text not null,
  raw_payload_hash text,
  received_at timestamptz not null default now(),
  status text not null default 'RECEIVED'
    check (status in ('RECEIVED', 'QUARANTINED', 'PROCESSED', 'FAILED', 'DEAD')),
  constraint payment_provider_delivery_uniq
    unique (provider, provider_event_id, provider_transaction_id)
);

create table if not exists public.payment_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null
    references public.payment_provider_deliveries(id) on delete restrict,
  attempt_no integer not null default 1,
  status text not null default 'PENDING',
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_posting_queue (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null
    references public.payment_provider_deliveries(id) on delete restrict,
  payment_request_id uuid references public.payment_requests(id) on delete set null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'POSTED', 'REVIEW', 'DEAD')),
  review_reason text,
  claimed_until timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create index payment_posting_queue_claim_idx
  on public.payment_posting_queue (status, claimed_until);

create or replace function public.block_payment_scaffold_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'payment scaffold ledger is append-only';
end;
$$;

revoke all on function public.block_payment_scaffold_mutation() from public, anon, authenticated;

drop trigger if exists trg_payment_request_events_append_only on public.payment_request_events;
create trigger trg_payment_request_events_append_only
before update or delete on public.payment_request_events
for each row execute function public.block_payment_scaffold_mutation();

drop trigger if exists trg_payment_deliveries_append_only on public.payment_provider_deliveries;
create trigger trg_payment_deliveries_append_only
before update or delete on public.payment_provider_deliveries
for each row execute function public.block_payment_scaffold_mutation();

drop trigger if exists trg_payment_attempts_append_only on public.payment_provider_attempts;
create trigger trg_payment_attempts_append_only
before update or delete on public.payment_provider_attempts
for each row execute function public.block_payment_scaffold_mutation();

alter table public.payment_requests enable row level security;
alter table public.payment_requests force row level security;
alter table public.payment_request_events enable row level security;
alter table public.payment_request_events force row level security;
alter table public.payment_provider_deliveries enable row level security;
alter table public.payment_provider_deliveries force row level security;
alter table public.payment_provider_attempts enable row level security;
alter table public.payment_provider_attempts force row level security;
alter table public.payment_posting_queue enable row level security;
alter table public.payment_posting_queue force row level security;
revoke all on table public.payment_requests from public, anon, authenticated;
revoke all on table public.payment_request_events from public, anon, authenticated;
revoke all on table public.payment_provider_deliveries from public, anon, authenticated;
revoke all on table public.payment_provider_attempts from public, anon, authenticated;
revoke all on table public.payment_posting_queue from public, anon, authenticated;

commit;
