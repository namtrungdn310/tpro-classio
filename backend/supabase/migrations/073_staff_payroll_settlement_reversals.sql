-- Forward-only payroll settlement reversal ledger.
-- A reversal compensates a settlement; it never mutates settlement history.

begin;

create table if not exists public.staff_payroll_settlement_reversals (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.staff_payroll_settlements(id) on delete restrict,
  staff_id uuid not null references public.staff_members(id) on delete restrict,
  request_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  actor_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint staff_payroll_settlement_reversals_settlement_uniq unique (settlement_id),
  constraint staff_payroll_settlement_reversals_request_uniq unique (request_id)
);

-- Reversed settlements release their allocations. The previous global uniqueness
-- cannot represent that; exactly-once is now enforced per settlement while the
-- service serializes each staff ledger with an advisory transaction lock.
drop index if exists public.staff_payroll_settlement_items_ledger_uniq;
create unique index if not exists staff_payroll_settlement_items_settlement_ledger_uniq
  on public.staff_payroll_settlement_items (settlement_id, ledger_entry_id);
create index if not exists staff_payroll_settlement_reversals_staff_created_idx
  on public.staff_payroll_settlement_reversals (staff_id, created_at desc);

create trigger trg_staff_settlement_reversal_append_only
before update or delete on public.staff_payroll_settlement_reversals
for each row execute function public.block_staff_ledger_mutation();

create trigger trg_staff_settlement_reversal_no_truncate
before truncate on public.staff_payroll_settlement_reversals
for each statement execute function public.block_staff_ledger_mutation();

alter table public.staff_payroll_settlement_reversals enable row level security;
alter table public.staff_payroll_settlement_reversals force row level security;
revoke all on table public.staff_payroll_settlement_reversals from public, anon, authenticated;
revoke all on table public.staff_payroll_settlement_reversals from public;

do $$
begin
  if to_regclass('public.staff_payroll_settlement_reversals') is null
     or to_regclass('public.staff_payroll_settlement_items_settlement_ledger_uniq') is null then
    raise exception '073 acceptance failed: payroll reversal objects missing';
  end if;
  if not (select relrowsecurity and relforcerowsecurity
          from pg_class where oid = 'public.staff_payroll_settlement_reversals'::regclass) then
    raise exception '073 acceptance failed: reversal RLS/FORCE missing';
  end if;
  if has_table_privilege('anon', 'public.staff_payroll_settlement_reversals', 'select')
     or has_table_privilege('authenticated', 'public.staff_payroll_settlement_reversals', 'select') then
    raise exception '073 acceptance failed: browser role can read payroll reversals';
  end if;
end $$;

commit;
