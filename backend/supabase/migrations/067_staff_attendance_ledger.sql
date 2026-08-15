-- R6-D15 — Payroll schema part 2: attendance + earning + settlement ledgers.
--
-- All ledgers are append-only; earning created immediately after a validated
-- check-in; balance always derived; settlement allocates immutable ledger at
-- cutoff (never UPDATE balance).

begin;

create table if not exists public.staff_attendance_entries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_members(id) on delete restrict,
  occurrence_class_id uuid not null references public.classes(id) on delete restrict,
  occurrence_slot_id uuid not null references public.class_schedule_slots(id) on delete restrict,
  occurrence_start_at timestamptz not null,
  occurrence_end_at timestamptz not null,
  occurrence_kind text not null check (occurrence_kind in ('REGULAR', 'MAKEUP')),
  staff_role text not null check (staff_role in ('TEACHER', 'ASSISTANT')),
  scheduled_start_at timestamptz not null,
  checkin_at timestamptz not null,
  rate_amount bigint not null check (rate_amount > 0),
  rate_version integer not null,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  constraint staff_attendance_staff_occurrence_uniq
    unique (staff_id, occurrence_class_id, occurrence_start_at)
);

create index staff_attendance_entries_staff_time_idx
  on public.staff_attendance_entries (staff_id, checkin_at desc);
create unique index staff_attendance_entries_request_uniq
  on public.staff_attendance_entries (request_id);

create table if not exists public.staff_earning_ledger (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_members(id) on delete restrict,
  attendance_entry_id uuid not null
    references public.staff_attendance_entries(id) on delete restrict,
  entry_type text not null check (entry_type in ('EARNING', 'REVERSAL', 'ADJUSTMENT')),
  amount bigint not null,
  related_entry_id uuid references public.staff_earning_ledger(id) on delete restrict,
  reason text,
  request_id uuid not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint staff_earning_attendance_uniq
    unique (attendance_entry_id, entry_type)
);

create index staff_earning_ledger_staff_idx
  on public.staff_earning_ledger (staff_id, created_at);

create table if not exists public.staff_payroll_settlements (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_members(id) on delete restrict,
  cutoff_at timestamptz not null,
  total_amount bigint not null check (total_amount >= 0),
  high_watermark_ledger_id uuid
    references public.staff_earning_ledger(id) on delete restrict,
  method text not null,
  reference text,
  reason text,
  request_id uuid not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_payroll_settlement_items (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null
    references public.staff_payroll_settlements(id) on delete restrict,
  ledger_entry_id uuid not null
    references public.staff_earning_ledger(id) on delete restrict,
  allocated_amount bigint not null check (allocated_amount > 0),
  constraint staff_payroll_settlement_items_uniq
    unique (settlement_id, ledger_entry_id)
);

create index staff_payroll_settlements_staff_cutoff_idx
  on public.staff_payroll_settlements (staff_id, cutoff_at desc);
create index staff_payroll_settlement_items_ledger_idx
  on public.staff_payroll_settlement_items (ledger_entry_id);

create or replace function public.block_staff_ledger_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'staff payroll ledgers are append-only';
end;
$$;

revoke all on function public.block_staff_ledger_mutation() from public, anon, authenticated;

drop trigger if exists trg_staff_attendance_append_only on public.staff_attendance_entries;
create trigger trg_staff_attendance_append_only
before update or delete on public.staff_attendance_entries
for each row execute function public.block_staff_ledger_mutation();
drop trigger if exists trg_staff_attendance_no_truncate on public.staff_attendance_entries;
create trigger trg_staff_attendance_no_truncate
before truncate on public.staff_attendance_entries
for each statement execute function public.block_staff_ledger_mutation();

drop trigger if exists trg_staff_earning_append_only on public.staff_earning_ledger;
create trigger trg_staff_earning_append_only
before update or delete on public.staff_earning_ledger
for each row execute function public.block_staff_ledger_mutation();
drop trigger if exists trg_staff_earning_no_truncate on public.staff_earning_ledger;
create trigger trg_staff_earning_no_truncate
before truncate on public.staff_earning_ledger
for each statement execute function public.block_staff_ledger_mutation();

drop trigger if exists trg_staff_settlement_append_only on public.staff_payroll_settlements;
create trigger trg_staff_settlement_append_only
before update or delete on public.staff_payroll_settlements
for each row execute function public.block_staff_ledger_mutation();
drop trigger if exists trg_staff_settlement_no_truncate on public.staff_payroll_settlements;
create trigger trg_staff_settlement_no_truncate
before truncate on public.staff_payroll_settlements
for each statement execute function public.block_staff_ledger_mutation();

drop trigger if exists trg_staff_settlement_items_append_only on public.staff_payroll_settlement_items;
create trigger trg_staff_settlement_items_append_only
before update or delete on public.staff_payroll_settlement_items
for each row execute function public.block_staff_ledger_mutation();
drop trigger if exists trg_staff_settlement_items_no_truncate on public.staff_payroll_settlement_items;
create trigger trg_staff_settlement_items_no_truncate
before truncate on public.staff_payroll_settlement_items
for each statement execute function public.block_staff_ledger_mutation();

alter table public.staff_attendance_entries enable row level security;
alter table public.staff_attendance_entries force row level security;
alter table public.staff_earning_ledger enable row level security;
alter table public.staff_earning_ledger force row level security;
alter table public.staff_payroll_settlements enable row level security;
alter table public.staff_payroll_settlements force row level security;
alter table public.staff_payroll_settlement_items enable row level security;
alter table public.staff_payroll_settlement_items force row level security;
revoke all on table public.staff_attendance_entries from public, anon, authenticated;
revoke all on table public.staff_earning_ledger from public, anon, authenticated;
revoke all on table public.staff_payroll_settlements from public, anon, authenticated;
revoke all on table public.staff_payroll_settlement_items from public, anon, authenticated;

commit;
