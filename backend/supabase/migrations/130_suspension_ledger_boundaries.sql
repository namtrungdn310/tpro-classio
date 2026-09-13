-- Defense in depth for suspension commands and signed credit allocations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function public.check_suspension_command_boundary()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if new.enrollment_suspension_id is not null and not exists (
    select 1 from public.enrollment_suspensions s
    where s.id = new.enrollment_suspension_id and s.workspace_id = new.workspace_id
  ) then raise exception 'suspension command belongs to another workspace'; end if;
  if new.class_adjustment_id is not null and not exists (
    select 1 from public.class_schedule_adjustments a where a.id = new.class_adjustment_id
      and a.workspace_id = new.workspace_id and a.adjustment_kind = 'CLASS_SUSPENSION'
  ) then raise exception 'suspension command must reference a class service pause'; end if;
  return new;
end;
$$;
revoke all on function public.check_suspension_command_boundary() from public, anon, authenticated;
drop trigger if exists zz_suspension_command_boundary on public.suspension_commands;
create trigger zz_suspension_command_boundary before insert on public.suspension_commands
  for each row execute function public.check_suspension_command_boundary();

create or replace function public.check_suspension_credit_command()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if not exists (select 1 from public.enrollments e where e.id = new.enrollment_id
    and e.class_id = new.class_id and e.workspace_id = new.workspace_id) then
    raise exception 'service credit membership boundary mismatch';
  end if;
  if new.suspension_command_id is not null and not exists (
    select 1 from public.suspension_commands c
      left join public.enrollment_suspensions s on s.id = c.enrollment_suspension_id
      left join public.class_schedule_adjustments a on a.id = c.class_adjustment_id
    where c.id = new.suspension_command_id and c.workspace_id = new.workspace_id
      and (s.enrollment_id = new.enrollment_id or a.class_id = new.class_id)
  ) then raise exception 'credit command must reference the same membership or class'; end if;
  return new;
end;
$$;
revoke all on function public.check_suspension_credit_command() from public, anon, authenticated;
drop trigger if exists suspension_credit_command_boundary on public.enrollment_service_credit_events;
create constraint trigger suspension_credit_command_boundary after insert on public.enrollment_service_credit_events
  deferrable initially deferred for each row execute function public.check_suspension_credit_command();

create or replace function public.service_credit_allocation_within_balance()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare event_days integer; event_enrollment uuid; event_workspace uuid; allocated bigint;
begin
  select credit_days, enrollment_id, workspace_id into event_days, event_enrollment, event_workspace
    from public.enrollment_service_credit_events where id = new.credit_event_id for update;
  if event_days is null or event_workspace <> new.workspace_id or not exists (
    select 1 from public.fee_records f where f.id = new.fee_record_id
      and f.enrollment_id = event_enrollment and f.workspace_id = new.workspace_id
      and f.cycle_no > 0 and f.status = 'UNPAID' and not f.review_required
      and f.notified_at is null and f.paid_date is null
      and coalesce(f.paid_amount, 0) = 0 and coalesce(f.refunded_amount, 0) = 0
      and not exists (select 1 from public.payments p where p.fee_record_id = f.id)
  ) then raise exception 'service credit target must be an editable renewal of the same membership'; end if;
  if new.applies_from is not null and new.applies_from is distinct from (
    select coverage_start from public.fee_records where id = new.fee_record_id
  ) then raise exception 'service credit boundary must equal target coverage start'; end if;
  select coalesce(sum(allocated_days), 0) into allocated
    from public.service_credit_allocations where credit_event_id = new.credit_event_id;
  if allocated + new.allocated_days > event_days then
    raise exception 'service credit allocation exceeds event balance';
  end if;
  return new;
end;
$$;
revoke all on function public.service_credit_allocation_within_balance() from public, anon, authenticated;
-- Alphabetical trigger order: stamp workspace before inspecting boundaries.
drop trigger if exists trg_service_credit_allocation_balance on public.service_credit_allocations;
drop trigger if exists zz_service_credit_allocation_balance on public.service_credit_allocations;
create trigger zz_service_credit_allocation_balance before insert on public.service_credit_allocations
  for each row execute function public.service_credit_allocation_within_balance();

drop trigger if exists enrollment_suspensions_no_delete on public.enrollment_suspensions;
create trigger enrollment_suspensions_no_delete before delete on public.enrollment_suspensions
  for each row execute function public.block_service_credit_mutation();
drop trigger if exists enrollment_suspensions_no_truncate on public.enrollment_suspensions;
create trigger enrollment_suspensions_no_truncate before truncate on public.enrollment_suspensions
  for each statement execute function public.block_service_credit_mutation();
commit;
