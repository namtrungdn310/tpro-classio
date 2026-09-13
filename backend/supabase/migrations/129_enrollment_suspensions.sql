-- Individual pauses belong to one membership, never to the student globally.
-- No backfill guesses and no update/delete of financial history.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table if not exists public.enrollment_suspensions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  suspended_from date not null,
  resume_on date not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED')),
  version integer not null default 1 check (version > 0),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (resume_on > suspended_from and resume_on - suspended_from <= 120)
);
create index if not exists enrollment_suspensions_member_window
  on public.enrollment_suspensions (workspace_id, enrollment_id, suspended_from, id);

create table if not exists public.suspension_commands (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  enrollment_suspension_id uuid references public.enrollment_suspensions(id) on delete restrict,
  class_adjustment_id uuid references public.class_schedule_adjustments(id) on delete restrict,
  request_id uuid not null,
  actor_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  before_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, actor_id, request_id),
  check (num_nonnulls(enrollment_suspension_id, class_adjustment_id) = 1)
);
create index if not exists suspension_commands_member
  on public.suspension_commands (workspace_id, enrollment_suspension_id, created_at);
alter table public.enrollment_service_credit_events
  add column if not exists suspension_command_id uuid
    references public.suspension_commands(id) on delete restrict deferrable initially deferred;
create unique index if not exists suspension_credit_command_once
  on public.enrollment_service_credit_events (suspension_command_id, enrollment_id, event_type)
  where suspension_command_id is not null;
-- A newly allocated benefit starts at the confirmed target coverage. Preserve
-- legacy NULL semantics instead of retroactively changing old due dates.
alter table public.service_credit_allocations
  add column if not exists applies_from date;

create or replace function public.check_enrollment_suspension_boundary()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if not exists (select 1 from public.enrollments e where e.id = new.enrollment_id
    and e.workspace_id = new.workspace_id) then
    raise exception 'suspension membership belongs to another workspace';
  end if;
  if tg_op = 'UPDATE' and (new.enrollment_id <> old.enrollment_id or new.workspace_id <> old.workspace_id) then
    raise exception 'suspension membership is immutable';
  end if;
  return new;
end;
$$;
revoke all on function public.check_enrollment_suspension_boundary() from public, anon, authenticated;
drop trigger if exists zz_enrollment_suspension_boundary on public.enrollment_suspensions;
create trigger zz_enrollment_suspension_boundary before insert or update on public.enrollment_suspensions
  for each row execute function public.check_enrollment_suspension_boundary();

do $$
declare t text;
begin
  foreach t in array array['enrollment_suspensions', 'suspension_commands'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('drop trigger if exists workspace_stamp on public.%I', t);
    execute format('create trigger workspace_stamp before insert or update on public.%I for each row execute function public.stamp_workspace_id()', t);
    if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
      execute format('grant select, insert, update on public.%I to tpro_runtime', t);
      execute format('drop policy if exists workspace_boundary on public.%I', t);
      execute format('create policy workspace_boundary on public.%I for all to tpro_runtime using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id())', t);
    end if;
  end loop;
end $$;
drop trigger if exists suspension_commands_immutable on public.suspension_commands;
create trigger suspension_commands_immutable before update or delete on public.suspension_commands
  for each row execute function public.block_service_credit_mutation();
drop trigger if exists suspension_commands_no_truncate on public.suspension_commands;
create trigger suspension_commands_no_truncate before truncate on public.suspension_commands
  for each statement execute function public.block_service_credit_mutation();
-- Changing kind must not bypass the class overlap invariant.
drop trigger if exists trg_class_schedule_adjustments_no_overlap on public.class_schedule_adjustments;
create trigger trg_class_schedule_adjustments_no_overlap
before insert or update of class_id, affected_from, affected_through, status, adjustment_kind
on public.class_schedule_adjustments for each row execute function public.block_overlapping_open_suspension();
commit;
