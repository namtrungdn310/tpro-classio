-- R6-D15 — Payroll schema part 1: compensation rates (expand phase).
--
-- `staff_compensation_rates` = CURRENT effective-range projection (versioned,
-- no overlap, positive VND); `staff_compensation_rate_events` = append-only
-- before/after snapshots. Never call the projection row append-only.

begin;

create table if not exists public.staff_compensation_rates (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_members(id) on delete restrict,
  rate_amount bigint not null check (rate_amount > 0 and rate_amount <= 999999999999),
  effective_from date not null,
  effective_to date,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  constraint staff_compensation_rates_range
    check (effective_from <= effective_to or effective_to is null)
);

create unique index staff_compensation_rates_staff_version_uniq
  on public.staff_compensation_rates (staff_id, version);
create index staff_compensation_rates_staff_effective_idx
  on public.staff_compensation_rates (staff_id, effective_from, effective_to);

create table if not exists public.staff_compensation_rate_events (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_members(id) on delete restrict,
  event_type text not null check (event_type in ('CREATE', 'UPDATE', 'CLOSE')),
  before_snapshot jsonb not null default '{}',
  after_snapshot jsonb not null default '{}',
  actor_user_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index staff_compensation_rate_events_staff_idx
  on public.staff_compensation_rate_events (staff_id, created_at);

create or replace function public.block_compensation_rate_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'compensation rate events are append-only';
end;
$$;

revoke all on function public.block_compensation_rate_event_mutation() from public, anon, authenticated;

drop trigger if exists trg_compensation_rate_events_append_only on public.staff_compensation_rate_events;
create trigger trg_compensation_rate_events_append_only
before update or delete on public.staff_compensation_rate_events
for each row execute function public.block_compensation_rate_event_mutation();
drop trigger if exists trg_compensation_rate_events_no_truncate on public.staff_compensation_rate_events;
create trigger trg_compensation_rate_events_no_truncate
before truncate on public.staff_compensation_rate_events
for each statement execute function public.block_compensation_rate_event_mutation();

-- No-overlap guard cho projection hiện tại.
create or replace function public.staff_compensation_rates_no_overlap()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1
      from public.staff_compensation_rates other
     where other.staff_id = new.staff_id
       and other.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000')
       and other.effective_from < coalesce(new.effective_to, 'infinity'::date)
       and coalesce(other.effective_to, 'infinity'::date) > new.effective_from
  ) then
    raise exception 'compensation rate ranges must not overlap';
  end if;
  return new;
end;
$$;

revoke all on function public.staff_compensation_rates_no_overlap() from public, anon, authenticated;

drop trigger if exists trg_staff_compensation_rates_no_overlap on public.staff_compensation_rates;
create trigger trg_staff_compensation_rates_no_overlap
before insert or update on public.staff_compensation_rates
for each row execute function public.staff_compensation_rates_no_overlap();

alter table public.staff_compensation_rates enable row level security;
alter table public.staff_compensation_rates force row level security;
alter table public.staff_compensation_rate_events enable row level security;
alter table public.staff_compensation_rate_events force row level security;
revoke all on table public.staff_compensation_rates from public, anon, authenticated;
revoke all on table public.staff_compensation_rate_events from public, anon, authenticated;

commit;
