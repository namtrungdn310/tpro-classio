-- Effective-dated student memberships and durable membership-command audit.
-- ``ended_on`` is an exclusive boundary for one enrollment; it is not a
-- planned class end date.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.enrollments
  add column if not exists ended_on date;

-- Only backfill dates supported by an existing lifecycle timestamp. Cancelled
-- future memberships stay excluded by status and do not need an invented end.
update public.enrollments enrollment
set ended_on = greatest(
      enrollment.enrollment_date,
      (enrollment.ended_at at time zone 'Asia/Ho_Chi_Minh')::date
    )
where enrollment.ended_on is null
  and enrollment.enrollment_date is not null
  and enrollment.ended_at is not null
  and enrollment.status::text in ('dropped', 'completed');

alter table public.enrollments
  drop constraint if exists enrollments_effective_range_check;
alter table public.enrollments
  add constraint enrollments_effective_range_check
  check (ended_on is null or enrollment_date is null or ended_on >= enrollment_date)
  not valid;
alter table public.enrollments validate constraint enrollments_effective_range_check;

create index if not exists enrollments_class_effective_range_idx
  on public.enrollments (workspace_id, class_id, enrollment_date, ended_on)
  where status <> 'cancelled';
create index if not exists enrollments_student_effective_range_idx
  on public.enrollments (workspace_id, student_id, enrollment_date, ended_on)
  where status <> 'cancelled';

create table if not exists public.student_membership_commands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null check (char_length(payload_hash) = 64),
  preview_fingerprint text,
  student_id uuid not null references public.students(id) on delete restrict,
  source_enrollment_id uuid references public.enrollments(id) on delete restrict,
  mode text not null check (mode in ('supplement', 'transfer')),
  state text not null default 'PENDING' check (state in ('PENDING', 'COMPLETED')),
  target_count integer not null default 0 check (target_count between 0 and 20),
  actor_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint student_membership_commands_request_unique unique (workspace_id, request_id),
  constraint student_membership_commands_state_shape check (
    (state = 'PENDING' and completed_at is null)
    or (state = 'COMPLETED' and completed_at is not null)
  )
);

create table if not exists public.student_membership_command_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  command_id uuid not null references public.student_membership_commands(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete restrict,
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  requested_start date,
  resolved_start date not null,
  custom_fee_snapshot numeric(12,0),
  selected_slot_ids uuid[],
  constraint student_membership_command_items_class_unique unique (command_id, class_id)
);

create index if not exists student_membership_commands_student_idx
  on public.student_membership_commands (workspace_id, student_id, created_at desc);
create index if not exists student_membership_command_items_enrollment_idx
  on public.student_membership_command_items (enrollment_id);

alter table public.billing_anchor_revisions
  drop constraint if exists billing_anchor_revisions_change_kind_check;
alter table public.billing_anchor_revisions
  add constraint billing_anchor_revisions_change_kind_check check (
    change_kind in (
      'INITIAL', 'INITIAL_BACKDATED', 'ENROLLMENT_DATE_CHANGE',
      'PACKAGE_DURATION_CHANGE', 'MEMBERSHIP_TRANSFER'
    )
  ) not valid;
alter table public.billing_anchor_revisions
  validate constraint billing_anchor_revisions_change_kind_check;

create or replace function public.guard_student_membership_command_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.state = 'PENDING'
     and new.state = 'COMPLETED'
     and new.completed_at is not null
     and (to_jsonb(new) - 'state' - 'completed_at')
         = (to_jsonb(old) - 'state' - 'completed_at') then
    return new;
  end if;
  raise exception 'student membership command audit is immutable';
end;
$$;

create or replace function public.reject_immutable_membership_item_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'student membership command items are append-only';
end;
$$;

drop trigger if exists student_membership_commands_update_guard
  on public.student_membership_commands;
create trigger student_membership_commands_update_guard
before update on public.student_membership_commands
for each row execute function public.guard_student_membership_command_update();

drop trigger if exists student_membership_commands_no_delete
  on public.student_membership_commands;
create trigger student_membership_commands_no_delete
before delete on public.student_membership_commands
for each row execute function public.reject_immutable_membership_item_change();

drop trigger if exists student_membership_command_items_immutable
  on public.student_membership_command_items;
create trigger student_membership_command_items_immutable
before update or delete on public.student_membership_command_items
for each row execute function public.reject_immutable_membership_item_change();

create or replace function public.enforce_membership_relational_integrity()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  enrollment_row record;
  slot_row record;
  revision_row record;
begin
  if tg_table_name = 'enrollments' then
    if new.current_billing_revision_id is null then return new; end if;
    select r.enrollment_id, r.workspace_id
      into revision_row
      from public.billing_anchor_revisions r
     where r.id = new.current_billing_revision_id;
    if not found
       or revision_row.enrollment_id <> new.id
       or revision_row.workspace_id <> new.workspace_id then
      raise exception 'current billing revision does not match enrollment';
    end if;
    return new;
  end if;

  if tg_table_name = 'fee_records' then
    if new.billing_revision_id is null then return new; end if;
    select r.enrollment_id, r.workspace_id into revision_row
      from public.billing_anchor_revisions r where r.id = new.billing_revision_id;
    if not found
       or revision_row.enrollment_id <> new.enrollment_id
       or revision_row.workspace_id <> new.workspace_id then
      raise exception 'fee billing revision does not match enrollment';
    end if;
    return new;
  end if;

  select e.class_id, e.workspace_id into enrollment_row
    from public.enrollments e where e.id = new.enrollment_id;
  select s.class_id, s.workspace_id into slot_row
    from public.class_schedule_slots s where s.id = new.slot_id;
  if not found
     or enrollment_row.class_id <> slot_row.class_id
     or enrollment_row.workspace_id <> new.workspace_id
     or slot_row.workspace_id <> new.workspace_id then
    raise exception 'enrollment slot selection does not match enrollment class';
  end if;
  return new;
end;
$$;

drop trigger if exists enrollments_billing_revision_integrity on public.enrollments;
create constraint trigger enrollments_billing_revision_integrity
after insert or update of current_billing_revision_id, enrollment_date
on public.enrollments deferrable initially deferred
for each row execute function public.enforce_membership_relational_integrity();

drop trigger if exists fee_records_billing_revision_integrity on public.fee_records;
create constraint trigger fee_records_billing_revision_integrity
after insert or update of billing_revision_id, enrollment_id
on public.fee_records deferrable initially deferred
for each row execute function public.enforce_membership_relational_integrity();

drop trigger if exists enrollment_slot_selection_class_integrity
  on public.enrollment_slot_selections;
create constraint trigger enrollment_slot_selection_class_integrity
after insert or update of enrollment_id, slot_id
on public.enrollment_slot_selections deferrable initially deferred
for each row execute function public.enforce_membership_relational_integrity();

alter table public.student_membership_commands enable row level security;
alter table public.student_membership_commands force row level security;
alter table public.student_membership_command_items enable row level security;
alter table public.student_membership_command_items force row level security;
revoke all on table public.student_membership_commands from public, anon, authenticated;
revoke all on table public.student_membership_command_items from public, anon, authenticated;

do $$
declare runtime_role name;
begin
  for runtime_role in
    select rolname from pg_roles where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    execute format(
      'grant select, insert, update on table public.student_membership_commands to %I',
      runtime_role
    );
    execute format(
      'grant select, insert on table public.student_membership_command_items to %I',
      runtime_role
    );
  end loop;
  if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
    drop policy if exists student_membership_commands_workspace_boundary
      on public.student_membership_commands;
    create policy student_membership_commands_workspace_boundary
      on public.student_membership_commands for all to tpro_runtime
      using (workspace_id = public.current_workspace_id())
      with check (workspace_id = public.current_workspace_id());
    drop policy if exists student_membership_command_items_workspace_boundary
      on public.student_membership_command_items;
    create policy student_membership_command_items_workspace_boundary
      on public.student_membership_command_items for all to tpro_runtime
      using (workspace_id = public.current_workspace_id())
      with check (workspace_id = public.current_workspace_id());
  end if;
end $$;

drop trigger if exists student_membership_commands_workspace_stamp
  on public.student_membership_commands;
create trigger student_membership_commands_workspace_stamp
before insert or update on public.student_membership_commands
for each row execute function public.stamp_workspace_id();
drop trigger if exists student_membership_command_items_workspace_stamp
  on public.student_membership_command_items;
create trigger student_membership_command_items_workspace_stamp
before insert on public.student_membership_command_items
for each row execute function public.stamp_workspace_id();

create or replace function public.membership_effective_date_version()
returns integer
language sql
stable
set search_path = pg_catalog
as $$ select 1 $$;
revoke all on function public.membership_effective_date_version() from public;
do $$
declare runtime_role name;
begin
  for runtime_role in
    select rolname from pg_roles where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    execute format(
      'grant execute on function public.membership_effective_date_version() to %I',
      runtime_role
    );
  end loop;
end $$;

commit;
