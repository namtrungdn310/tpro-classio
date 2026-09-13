-- R6-D11 — Service-credit append-only ledger (forward-only expand).
--
-- Contract: dev.md §8.1, test.md §5.3. Whole-class suspension grants
-- calendar-day overlap to every ACTIVE enrollment (half-open
-- [suspended_from, resume_on)); cycle 0 never receives credit; targets are
-- future unprotected cycles; all corrections are compensating entries.

begin;

create table if not exists public.enrollment_service_credit_events (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  adjustment_id uuid references public.class_schedule_adjustments(id) on delete set null,
  event_type text not null check (event_type in ('GRANT', 'REVERSAL')),
  overlap_start date not null,
  overlap_end date not null,
  credit_days integer not null check (credit_days >= 0),
  request_id uuid not null,
  version integer not null default 1,
  actor_user_id uuid references public.profiles(id) on delete set null,
  reason_snapshot text,
  created_at timestamptz not null default now(),
  constraint service_credit_overlap_half_open
    check (overlap_start <= overlap_end),
  constraint service_credit_exact_once
    unique (class_id, adjustment_id, enrollment_id, event_type)
);

create table if not exists public.service_credit_allocations (
  id uuid primary key default gen_random_uuid(),
  credit_event_id uuid not null
    references public.enrollment_service_credit_events(id) on delete restrict,
  fee_record_id uuid not null references public.fee_records(id) on delete restrict,
  allocated_days integer not null check (allocated_days > 0),
  created_at timestamptz not null default now(),
  constraint service_credit_allocation_unique
    unique (credit_event_id, fee_record_id)
);

drop index if exists enrollment_service_credit_events_enrollment_idx;
create index enrollment_service_credit_events_enrollment_idx
  on public.enrollment_service_credit_events (enrollment_id, created_at);
drop index if exists service_credit_allocations_fee_idx;
create index service_credit_allocations_fee_idx
  on public.service_credit_allocations (fee_record_id);

create or replace function public.block_service_credit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'service credit ledger is append-only';
end;
$$;

revoke all on function public.block_service_credit_mutation() from public, anon, authenticated;

drop trigger if exists trg_service_credit_events_append_only on public.enrollment_service_credit_events;
create trigger trg_service_credit_events_append_only
before update or delete on public.enrollment_service_credit_events
for each row execute function public.block_service_credit_mutation();
drop trigger if exists trg_service_credit_events_no_truncate on public.enrollment_service_credit_events;
create trigger trg_service_credit_events_no_truncate
before truncate on public.enrollment_service_credit_events
for each statement execute function public.block_service_credit_mutation();

drop trigger if exists trg_service_credit_allocations_append_only on public.service_credit_allocations;
create trigger trg_service_credit_allocations_append_only
before update or delete on public.service_credit_allocations
for each row execute function public.block_service_credit_mutation();
drop trigger if exists trg_service_credit_allocations_no_truncate on public.service_credit_allocations;
create trigger trg_service_credit_allocations_no_truncate
before truncate on public.service_credit_allocations
for each statement execute function public.block_service_credit_mutation();

-- Allocation sum không được vượt event balance.
create or replace function public.service_credit_allocation_within_balance()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  event_days integer;
  allocated integer;
begin
  select credit_days into event_days
    from public.enrollment_service_credit_events
   where id = new.credit_event_id;
  select coalesce(sum(allocated_days), 0) into allocated
    from public.service_credit_allocations
   where credit_event_id = new.credit_event_id;
  if allocated > event_days then
    raise exception 'service credit allocation exceeds event balance';
  end if;
  return new;
end;
$$;

revoke all on function public.service_credit_allocation_within_balance() from public, anon, authenticated;

drop trigger if exists trg_service_credit_allocation_balance on public.service_credit_allocations;
create trigger trg_service_credit_allocation_balance
before insert or update on public.service_credit_allocations
for each row execute function public.service_credit_allocation_within_balance();

alter table public.enrollment_service_credit_events enable row level security;
alter table public.enrollment_service_credit_events force row level security;
alter table public.service_credit_allocations enable row level security;
alter table public.service_credit_allocations force row level security;
revoke all on table public.enrollment_service_credit_events from public, anon, authenticated;
revoke all on table public.service_credit_allocations from public, anon, authenticated;

commit;
