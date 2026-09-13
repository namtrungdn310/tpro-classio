-- Forward-only: financial boundaries for compensating suspension entries.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function public.check_suspension_signed_event()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare balance bigint;
begin
  perform 1 from public.enrollments where id = new.enrollment_id for update;
  if new.event_type = 'REVERSAL' then
    select coalesce(sum(case when event_type = 'REVERSAL' then -credit_days else credit_days end), 0)
      into balance from public.enrollment_service_credit_events where enrollment_id = new.enrollment_id;
    if balance < new.credit_days then raise exception 'suspension reversal exceeds granted days'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.check_suspension_signed_event() from public, anon, authenticated;
drop trigger if exists zz_suspension_signed_event on public.enrollment_service_credit_events;
create trigger zz_suspension_signed_event before insert on public.enrollment_service_credit_events
  for each row execute function public.check_suspension_signed_event();

create or replace function public.check_suspension_request_protection()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if exists (select 1 from public.payment_requests r
    left join public.payment_request_items i on i.payment_request_id = r.id
    where r.workspace_id = new.workspace_id and (r.fee_record_id = new.fee_record_id or i.fee_record_id = new.fee_record_id)
      and (r.sent_at is not null or r.paid_at is not null or r.status = 'PAID')) then
    raise exception 'suspension cannot change a sent or settled payment request';
  end if;
  return new;
end;
$$;
revoke all on function public.check_suspension_request_protection() from public, anon, authenticated;
drop trigger if exists zz_suspension_request_protection on public.service_credit_allocations;
create trigger zz_suspension_request_protection before insert on public.service_credit_allocations
  for each row execute function public.check_suspension_request_protection();

create or replace function public.check_suspension_allocation_windows()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare member uuid;
begin
  select enrollment_id into member from public.enrollment_service_credit_events where id = new.credit_event_id;
  perform 1 from public.enrollments where id = member for update;
  if exists (
    select 1 from (
      select sum(sum(a.allocated_days * case when e.event_type = 'REVERSAL' then -1 else 1 end))
        over (order by coalesce(a.applies_from, e.overlap_start)) as balance
      from public.enrollment_service_credit_events e
      join public.service_credit_allocations a on a.credit_event_id = e.id
      where e.enrollment_id = member
      group by coalesce(a.applies_from, e.overlap_start)
    ) balances where balance < 0
  ) then raise exception 'suspension allocation cannot precede its compensating grant'; end if;
  return new;
end;
$$;
revoke all on function public.check_suspension_allocation_windows() from public, anon, authenticated;
drop trigger if exists suspension_allocation_windows on public.service_credit_allocations;
create constraint trigger suspension_allocation_windows after insert on public.service_credit_allocations
  deferrable initially deferred for each row execute function public.check_suspension_allocation_windows();
commit;
