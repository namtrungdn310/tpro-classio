-- 121_start_date_change_commands.sql
-- Durable audit and relational model for flexible class and student start date changes with explicit billing decisions.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- 1. Create start_date_change_commands table
create table if not exists public.start_date_change_commands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_id uuid not null,
  subject_type text not null check (subject_type in ('CLASS', 'STUDENT')),
  class_id uuid references public.classes(id) on delete restrict,
  student_id uuid references public.students(id) on delete restrict,
  old_date date not null,
  new_date date not null,
  payload_hash text not null check (char_length(payload_hash) = 64),
  preview_fingerprint text,
  state text not null default 'PENDING' check (state in ('PENDING', 'COMPLETED')),
  item_count integer not null default 0 check (item_count >= 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  actor_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint start_date_change_commands_request_unique unique (workspace_id, request_id),
  constraint start_date_change_commands_state_shape check (
    (state = 'PENDING' and completed_at is null)
    or (state = 'COMPLETED' and completed_at is not null)
  ),
  constraint start_date_change_commands_subject_check check (
    (subject_type = 'CLASS' and class_id is not null)
    or (subject_type = 'STUDENT' and student_id is not null)
  )
);

-- 2. Create start_date_change_command_items table
create table if not exists public.start_date_change_command_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  command_id uuid not null references public.start_date_change_commands(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  old_enrollment_date date not null,
  new_enrollment_date date not null,
  decision_code text not null check (decision_code in (
    'KEEP_EXISTING_SCHEDULE',
    'KEEP_CURRENT_THEN_REANCHOR',
    'REANCHOR_CURRENT_CYCLE',
    'REANCHOR_NEXT_BOUNDARY',
    'REANCHOR_CUSTOM_BOUNDARY'
  )),
  previous_billing_revision_id uuid references public.billing_anchor_revisions(id) on delete restrict,
  next_billing_revision_id uuid references public.billing_anchor_revisions(id) on delete restrict,
  first_anchor_cycle_no integer not null check (first_anchor_cycle_no >= 0),
  selected_historical_cycles integer[],
  protected_fee_count integer not null default 0 check (protected_fee_count >= 0),
  superseded_fee_count integer not null default 0 check (superseded_fee_count >= 0),
  skipped_cycle_count integer not null default 0 check (skipped_cycle_count >= 0),
  review_fee_record_id uuid references public.fee_records(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint start_date_change_command_items_unique unique (command_id, enrollment_id)
);

-- 3. Expand billing_anchor_revisions table
alter table public.billing_anchor_revisions
  add column if not exists start_date_command_item_id uuid references public.start_date_change_command_items(id) on delete set null,
  add column if not exists decision_code text,
  add column if not exists previous_enrollment_date date,
  add column if not exists next_enrollment_date date,
  add column if not exists skipped_anchor_cycle_count integer not null default 0,
  add column if not exists selected_historical_cycles integer[];

alter table public.billing_anchor_revisions
  drop constraint if exists billing_anchor_revisions_change_kind_check;

alter table public.billing_anchor_revisions
  add constraint billing_anchor_revisions_change_kind_check check (
    change_kind in (
      'INITIAL', 'INITIAL_BACKDATED', 'ENROLLMENT_DATE_CHANGE',
      'PACKAGE_DURATION_CHANGE', 'MEMBERSHIP_TRANSFER',
      'CLASS_START_DATE_CHANGE', 'STUDENT_START_DATE_CHANGE'
    )
  ) not valid;

alter table public.billing_anchor_revisions
  validate constraint billing_anchor_revisions_change_kind_check;

-- 4. Indexes
create index if not exists start_date_change_commands_class_idx
  on public.start_date_change_commands (workspace_id, class_id, created_at desc);
create index if not exists start_date_change_commands_student_idx
  on public.start_date_change_commands (workspace_id, student_id, created_at desc);
create index if not exists start_date_change_command_items_enrollment_idx
  on public.start_date_change_command_items (workspace_id, enrollment_id);
create index if not exists billing_anchor_revisions_command_item_idx
  on public.billing_anchor_revisions (start_date_command_item_id)
  where start_date_command_item_id is not null;

-- 5. Append-only and state-shape triggers
create or replace function public.guard_start_date_change_command_update()
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
  raise exception 'start_date_change_commands rows are append-only; state may only advance from PENDING to COMPLETED';
end;
$$;

create or replace function public.guard_start_date_change_command_item_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'start_date_change_command_items rows are immutable once created';
end;
$$;

drop trigger if exists trg_guard_start_date_change_command_update
  on public.start_date_change_commands;
create trigger trg_guard_start_date_change_command_update
before update on public.start_date_change_commands
for each row execute function public.guard_start_date_change_command_update();

drop trigger if exists trg_guard_start_date_change_command_delete
  on public.start_date_change_commands;
create trigger trg_guard_start_date_change_command_delete
before delete on public.start_date_change_commands
for each row execute function public.guard_start_date_change_command_update();

drop trigger if exists trg_guard_start_date_change_command_item_update
  on public.start_date_change_command_items;
create trigger trg_guard_start_date_change_command_item_update
before update on public.start_date_change_command_items
for each row execute function public.guard_start_date_change_command_item_update();

drop trigger if exists trg_guard_start_date_change_command_item_delete
  on public.start_date_change_command_items;
create trigger trg_guard_start_date_change_command_item_delete
before delete on public.start_date_change_command_items
for each row execute function public.guard_start_date_change_command_item_update();

-- 6. Workspace stamp triggers
drop trigger if exists start_date_change_commands_workspace_stamp
  on public.start_date_change_commands;
create trigger start_date_change_commands_workspace_stamp
before insert or update on public.start_date_change_commands
for each row execute function public.stamp_workspace_id();

drop trigger if exists start_date_change_command_items_workspace_stamp
  on public.start_date_change_command_items;
create trigger start_date_change_command_items_workspace_stamp
before insert on public.start_date_change_command_items
for each row execute function public.stamp_workspace_id();

-- 7. Security and RLS
alter table public.start_date_change_commands enable row level security;
alter table public.start_date_change_commands force row level security;
alter table public.start_date_change_command_items enable row level security;
alter table public.start_date_change_command_items force row level security;

revoke all on table public.start_date_change_commands from public, anon, authenticated;
revoke all on table public.start_date_change_command_items from public, anon, authenticated;

do $$
declare runtime_role name;
begin
  for runtime_role in
    select rolname from pg_roles where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    execute format(
      'grant select, insert, update on table public.start_date_change_commands to %I',
      runtime_role
    );
    execute format(
      'grant select, insert on table public.start_date_change_command_items to %I',
      runtime_role
    );
  end loop;
  if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
    drop policy if exists start_date_change_commands_workspace_boundary
      on public.start_date_change_commands;
    create policy start_date_change_commands_workspace_boundary
      on public.start_date_change_commands for all to tpro_runtime
      using (workspace_id = public.current_workspace_id())
      with check (workspace_id = public.current_workspace_id());

    drop policy if exists start_date_change_command_items_workspace_boundary
      on public.start_date_change_command_items;
    create policy start_date_change_command_items_workspace_boundary
      on public.start_date_change_command_items for all to tpro_runtime
      using (workspace_id = public.current_workspace_id())
      with check (workspace_id = public.current_workspace_id());
  end if;
end $$;

-- 8. Readiness version probe
create or replace function public.start_date_change_command_version()
returns integer
language sql
stable
set search_path = pg_catalog
as $$ select 1 $$;

revoke all on function public.start_date_change_command_version() from public;

do $$
declare runtime_role name;
begin
  for runtime_role in
    select rolname from pg_roles where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    execute format(
      'grant execute on function public.start_date_change_command_version() to %I',
      runtime_role
    );
  end loop;
end $$;

commit;
