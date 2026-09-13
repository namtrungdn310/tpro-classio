-- Future cutovers retain bounded schedule segments, never years of invoices.
-- Additive only: no fee, payment, allocation or historical revision rewrite.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';
alter table public.billing_anchor_revisions
  add column if not exists scheduled_segments jsonb not null default '[]'::jsonb;
alter table public.billing_anchor_revisions
  add column if not exists waived_intervals jsonb not null default '[]'::jsonb;
alter table public.billing_anchor_revisions
  drop constraint if exists billing_schedule_segments_array;
alter table public.billing_anchor_revisions
  add constraint billing_schedule_segments_array
  check (jsonb_typeof(scheduled_segments) = 'array');
alter table public.billing_anchor_revisions
  drop constraint if exists billing_schedule_waivers_array;
alter table public.billing_anchor_revisions
  add constraint billing_schedule_waivers_array
  check (jsonb_typeof(waived_intervals) = 'array');
-- Carry allocation is append-only. Count the incoming row as well as existing
-- allocations and serialize on the event so concurrent inserts cannot overdraw.
create or replace function public.service_credit_allocation_within_balance()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  event_days integer;
  event_enrollment uuid;
  allocated bigint;
begin
  select credit_days, enrollment_id into event_days, event_enrollment
    from public.enrollment_service_credit_events
    where id = new.credit_event_id for update;
  if event_days is null or not exists (
    select 1 from public.fee_records where id = new.fee_record_id
      and enrollment_id = event_enrollment
  ) then
    raise exception 'service credit target must belong to the same enrollment';
  end if;
  select coalesce(sum(allocated_days), 0) into allocated
    from public.service_credit_allocations where credit_event_id = new.credit_event_id;
  if allocated + new.allocated_days > event_days then
    raise exception 'service credit allocation exceeds event balance';
  end if;
  return new;
end;
$$;
revoke all on function public.service_credit_allocation_within_balance() from public, anon, authenticated;
commit;
