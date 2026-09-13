-- Separate service interruption from occurrence-only makeup. No financial
-- history is rewritten and ambiguous legacy batches are NOT guessed away.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.class_schedule_adjustments
  add column if not exists adjustment_kind text not null default 'LEGACY_REVIEW',
  add column if not exists create_payload jsonb,
  add column if not exists create_result jsonb;
alter table public.class_schedule_adjustments
  drop constraint if exists class_schedule_adjustments_kind_check;
alter table public.class_schedule_adjustments
  add constraint class_schedule_adjustments_kind_check
  check (adjustment_kind in ('LEGACY_REVIEW', 'CLASS_SUSPENSION', 'OCCURRENCE'));

-- A credit ledger is positive evidence of a service suspension. An explicit
-- batch-created occurrence audit proves the isolated makeup command path.
update public.class_schedule_adjustments a set adjustment_kind = 'CLASS_SUSPENSION'
where adjustment_kind = 'LEGACY_REVIEW' and exists (
  select 1 from public.enrollment_service_credit_events e where e.adjustment_id = a.id
);
update public.class_schedule_adjustments a set adjustment_kind = 'OCCURRENCE'
where adjustment_kind = 'LEGACY_REVIEW' and exists (
  select 1 from public.class_session_exceptions x
  join public.class_schedule_adjustment_events e on e.exception_id = x.id
  where x.adjustment_id = a.id and e.event_type = 'batch-created'
);

create or replace function public.block_overlapping_open_suspension()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.adjustment_kind = 'OCCURRENCE' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('class-suspension:' || new.class_id::text, 0));
  if new.status = 'OPEN' and exists (
    select 1 from public.class_schedule_adjustments a
    where a.class_id = new.class_id and a.id <> new.id and a.status = 'OPEN'
      and a.adjustment_kind <> 'OCCURRENCE'
      and a.affected_from <= new.affected_through and a.affected_through >= new.affected_from
  ) then
    raise exception 'open suspension windows overlap for class %', new.class_id using errcode = '23P01';
  end if;
  return new;
end;
$$;
create or replace function public.block_enrollment_during_open_suspension()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.status = 'active' and new.enrollment_date is not null and exists (
    select 1 from public.class_schedule_adjustments a
    where a.class_id = new.class_id and a.status = 'OPEN' and a.adjustment_kind <> 'OCCURRENCE'
      and a.affected_from <= new.enrollment_date and a.affected_through >= new.enrollment_date
  ) then
    raise exception 'cannot enroll a student while the class is suspended' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.block_overlapping_open_suspension() from public, anon, authenticated;
revoke all on function public.block_enrollment_during_open_suspension() from public, anon, authenticated;

-- Creation receipts are immutable even if a later lifecycle command changes
-- the batch. Lost-response retries must return the original confirmed result.
create or replace function public.preserve_suspension_receipt()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if old.create_result is not null and (
    new.create_result is distinct from old.create_result or new.create_payload is distinct from old.create_payload
  ) then raise exception 'suspension creation receipt is immutable'; end if;
  return new;
end;
$$;
revoke all on function public.preserve_suspension_receipt() from public, anon, authenticated;
drop trigger if exists suspension_receipt_immutable on public.class_schedule_adjustments;
create trigger suspension_receipt_immutable before update on public.class_schedule_adjustments
for each row execute function public.preserve_suspension_receipt();
commit;
