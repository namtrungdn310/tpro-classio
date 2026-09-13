-- Versioned package duration changes for open-ended classes.
-- Existing paid/notified/refunded obligations remain immutable; only future
-- mutable projections may be superseded by the application command.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $$
begin
  if exists (
    select 1 from public.classes
    where billing_cycle_weeks is not null
      and billing_cycle_weeks not between 1 and 260
  ) then
    raise exception 'M118 preflight abort: class package duration outside 1..260 weeks';
  end if;
end $$;

alter table public.classes
  drop constraint if exists classes_billing_cycle_weeks_check;
alter table public.classes
  add constraint classes_billing_cycle_weeks_check
  check (billing_cycle_weeks is null or billing_cycle_weeks between 1 and 260)
  not valid;
alter table public.classes validate constraint classes_billing_cycle_weeks_check;

create table if not exists public.class_billing_cycle_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete restrict,
  previous_weeks smallint not null check (previous_weeks between 1 and 260),
  next_weeks smallint not null check (next_weeks between 1 and 260),
  effective_policy text not null default 'NEXT_PACKAGE_BOUNDARY'
    check (effective_policy = 'NEXT_PACKAGE_BOUNDARY'),
  state text not null default 'PENDING'
    check (state in ('PENDING', 'CONFIRMED', 'SUPERSEDED')),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  request_id uuid not null,
  class_version_before integer not null check (class_version_before >= 1),
  class_version_after integer not null check (class_version_after > class_version_before),
  affected_enrollment_count integer not null default 0 check (affected_enrollment_count >= 0),
  superseded_fee_count integer not null default 0 check (superseded_fee_count >= 0),
  protected_fee_count integer not null default 0 check (protected_fee_count >= 0),
  revoked_payment_request_count integer not null default 0 check (revoked_payment_request_count >= 0),
  effective_on date not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  constraint class_billing_cycle_revisions_request_unique
    unique (workspace_id, request_id),
  constraint class_billing_cycle_revisions_state_shape check (
    (state = 'PENDING' and resolved_at is null)
    or (state <> 'PENDING' and resolved_at is not null)
  )
);

alter table public.billing_anchor_revisions
  add column if not exists change_kind text,
  add column if not exists billing_type_snapshot text,
  add column if not exists billing_cycle_months_snapshot smallint,
  add column if not exists billing_cycle_weeks_snapshot smallint,
  add column if not exists class_billing_cycle_revision_id uuid;

update public.billing_anchor_revisions revision
set change_kind = coalesce(revision.change_kind, 'INITIAL'),
    billing_type_snapshot = coalesce(revision.billing_type_snapshot, class_.type::text),
    billing_cycle_months_snapshot = coalesce(
      revision.billing_cycle_months_snapshot,
      class_.billing_cycle_months
    ),
    billing_cycle_weeks_snapshot = case
      when coalesce(revision.billing_type_snapshot, class_.type::text) = 'COURSE'
      then coalesce(revision.billing_cycle_weeks_snapshot, class_.billing_cycle_weeks)
      else null
    end
from public.enrollments enrollment
join public.classes class_ on class_.id = enrollment.class_id
where enrollment.id = revision.enrollment_id;

do $$
begin
  if exists (
    select 1 from public.billing_anchor_revisions
    where change_kind is null
       or billing_type_snapshot not in ('MONTHLY', 'COURSE')
       or billing_cycle_months_snapshot is null
       or billing_cycle_months_snapshot < 1
       or (
         billing_type_snapshot = 'COURSE'
         and (billing_cycle_weeks_snapshot is null or billing_cycle_weeks_snapshot not between 1 and 260)
       )
       or (billing_type_snapshot = 'MONTHLY' and billing_cycle_weeks_snapshot is not null)
  ) then
    raise exception 'M118 preflight abort: ambiguous billing cadence revision';
  end if;
end $$;

alter table public.billing_anchor_revisions
  alter column change_kind set not null,
  alter column billing_type_snapshot set not null,
  alter column billing_cycle_months_snapshot set not null;

alter table public.billing_anchor_revisions
  drop constraint if exists billing_anchor_revisions_change_kind_check,
  add constraint billing_anchor_revisions_change_kind_check
    check (change_kind in ('INITIAL', 'ENROLLMENT_DATE_CHANGE', 'PACKAGE_DURATION_CHANGE'))
    not valid,
  drop constraint if exists billing_anchor_revisions_cadence_check,
  add constraint billing_anchor_revisions_cadence_check check (
    (billing_type_snapshot = 'MONTHLY' and billing_cycle_months_snapshot = 1 and billing_cycle_weeks_snapshot is null)
    or (billing_type_snapshot = 'COURSE' and billing_cycle_weeks_snapshot between 1 and 260)
  ) not valid;
alter table public.billing_anchor_revisions
  validate constraint billing_anchor_revisions_change_kind_check;
alter table public.billing_anchor_revisions
  validate constraint billing_anchor_revisions_cadence_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.billing_anchor_revisions'::regclass
      and conname = 'billing_anchor_revisions_class_cycle_fkey'
  ) then
    alter table public.billing_anchor_revisions
      add constraint billing_anchor_revisions_class_cycle_fkey
      foreign key (class_billing_cycle_revision_id)
      references public.class_billing_cycle_revisions(id) on delete restrict;
  end if;
end $$;

alter table public.class_lifecycle_events
  add column if not exists previous_billing_cycle_weeks smallint,
  add column if not exists next_billing_cycle_weeks smallint;

-- Keep the lifecycle audit constraint aligned with the new duration-change
-- command. This must be part of the same atomic migration; otherwise the
-- application can update the class but PostgreSQL rejects its audit event.
alter table public.class_lifecycle_events
  drop constraint if exists class_lifecycle_events_event_type_check;
alter table public.class_lifecycle_events
  add constraint class_lifecycle_events_event_type_check check (
    event_type = any (array[
      'created', 'identity_configured', 'end_date_changed', 'completed',
      'cancelled', 'archived', 'restored', 'schedule_changed',
      'schedule_slot_edited', 'schedule_slot_closed', 'start_date_changed',
      'stopped', 'billing_cycle_changed'
    ])
  ) not valid;
alter table public.class_lifecycle_events
  validate constraint class_lifecycle_events_event_type_check;

update public.fee_records fee
set class_type_snapshot = coalesce(
      fee.class_type_snapshot,
      revision.billing_type_snapshot::public.class_type
    ),
    billing_cycle_months_snapshot = coalesce(
      fee.billing_cycle_months_snapshot,
      revision.billing_cycle_months_snapshot
    ),
    billing_cycle_weeks_snapshot = case
      when coalesce(fee.class_type_snapshot::text, revision.billing_type_snapshot) = 'COURSE'
      then coalesce(fee.billing_cycle_weeks_snapshot, revision.billing_cycle_weeks_snapshot)
      else null
    end
from public.billing_anchor_revisions revision
where revision.id = fee.billing_revision_id;

alter table public.fee_records
  drop constraint if exists fee_records_billing_cycle_weeks_snapshot_check;
alter table public.fee_records
  add constraint fee_records_billing_cycle_weeks_snapshot_check
    check (billing_cycle_weeks_snapshot is null or billing_cycle_weeks_snapshot between 1 and 260)
    not valid;
alter table public.fee_records
  validate constraint fee_records_billing_cycle_weeks_snapshot_check;

-- Keep the append-only audit action contract aligned with backend/frontend.
alter table public.fee_operations
  drop constraint if exists fee_operations_action_check;
alter table public.fee_operations
  add constraint fee_operations_action_check check (
    action = any (array[
      'notify', 'unnotify', 'payment', 'payment_reversal', 'refund',
      'refund_reversal', 'sync', 'sync_void', 'supersede', 'template_update',
      'anchor_recalculation', 'billing_cycle_change'
    ])
  ) not valid;
alter table public.fee_operations validate constraint fee_operations_action_check;

create index if not exists class_billing_cycle_revisions_class_idx
  on public.class_billing_cycle_revisions (workspace_id, class_id, created_at desc);
create index if not exists class_billing_cycle_revisions_pending_idx
  on public.class_billing_cycle_revisions (workspace_id, created_at desc)
  where state = 'PENDING';
create index if not exists billing_anchor_revisions_class_cycle_idx
  on public.billing_anchor_revisions (class_billing_cycle_revision_id)
  where class_billing_cycle_revision_id is not null;

alter table public.class_billing_cycle_revisions enable row level security;
alter table public.class_billing_cycle_revisions force row level security;
revoke all on table public.class_billing_cycle_revisions from public, anon, authenticated;

do $$
declare runtime_role name;
begin
  for runtime_role in
    select rolname from pg_roles
    where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    execute format(
      'grant select, insert, update on table public.class_billing_cycle_revisions to %I',
      runtime_role
    );
  end loop;
  if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
    drop policy if exists class_billing_cycle_revisions_workspace_boundary
      on public.class_billing_cycle_revisions;
    create policy class_billing_cycle_revisions_workspace_boundary
      on public.class_billing_cycle_revisions for all to tpro_runtime
      using (workspace_id = public.current_workspace_id())
      with check (workspace_id = public.current_workspace_id());
  end if;
end $$;

drop trigger if exists class_billing_cycle_revisions_workspace_stamp
  on public.class_billing_cycle_revisions;
create trigger class_billing_cycle_revisions_workspace_stamp
before insert or update on public.class_billing_cycle_revisions
for each row execute function public.stamp_workspace_id();

create or replace function public.class_package_duration_revision_version()
returns integer
language sql
stable
set search_path = pg_catalog
as $$ select 1 $$;
revoke all on function public.class_package_duration_revision_version() from public;
do $$
declare runtime_role name;
begin
  for runtime_role in
    select rolname from pg_roles where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    execute format(
      'grant execute on function public.class_package_duration_revision_version() to %I',
      runtime_role
    );
  end loop;
end $$;

commit;
