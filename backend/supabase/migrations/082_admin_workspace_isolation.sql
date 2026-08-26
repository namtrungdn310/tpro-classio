-- R9 — hard tenant boundary per administrator account.
--
-- Every admin owns one workspace.  Teachers invited by that admin are members
-- of the same workspace; a newly invited admin receives a fresh, initially
-- owner-less workspace which is bound to the auth user during registration.
-- Existing single-tenant data is assigned to the oldest active admin (or the
-- explicit app.owner_user_id setting).  If more than one active admin already
-- exists, the migration aborts instead of guessing ownership and mixing data.
--
-- This is forward-only.  No historical migration is rewritten.  The ORM also
-- applies the boundary because Supabase's service/runtime role may bypass RLS.

begin;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid unique references auth.users(id) on delete set null,
  name text not null default 'TPRO English',
  created_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;
revoke all on table public.workspaces from public, anon, authenticated;

do $$
declare
  active_admin_count integer;
  owner_id uuid;
  owner_workspace_id uuid;
  table_name text;
begin
  select count(*) into active_admin_count
    from public.profiles
   where role = 'admin' and account_status <> 'disabled';
  if active_admin_count > 1 then
    raise exception
      'M082 abort: multiple active admin accounts require an explicit ownership map before isolation';
  end if;

  begin
    owner_id := nullif(current_setting('app.owner_user_id', true), '')::uuid;
  exception when others then
    owner_id := null;
  end;
  if owner_id is null then
    select p.id into owner_id
      from public.profiles p
     where p.role = 'admin' and p.account_status <> 'disabled'
     order by p.created_at asc, p.id asc
     limit 1;
  end if;
  if owner_id is null then
    raise exception 'M082 abort: no active admin profile can own the legacy data';
  end if;
  if not exists (select 1 from public.profiles where id = owner_id) then
    raise exception 'M082 abort: app.owner_user_id is not a known profile';
  end if;

  select w.id into owner_workspace_id
    from public.workspaces w
   where w.owner_user_id = owner_id
   limit 1;
  if owner_workspace_id is null then
    insert into public.workspaces (owner_user_id, name)
    values (owner_id, 'TPRO English')
    returning id into owner_workspace_id;
  end if;

  alter table public.profiles
    add column if not exists workspace_id uuid;
  update public.profiles
     set workspace_id = owner_workspace_id
   where workspace_id is null;
  alter table public.profiles
    alter column workspace_id set not null;

  -- All existing business rows belong to the one legacy tenant.  Future
  -- writes are stamped by the trigger below from app.workspace_id.
  foreach table_name in array array[
    'account_invitations', 'classes', 'class_lifecycle_events',
    'class_schedule_slots', 'class_schedule_slot_staff',
    'class_schedule_slot_teacher_events', 'class_teachers',
    'class_teacher_events', 'enrollments', 'enrollment_slot_selections',
    'enrollment_service_credit_events', 'service_credit_allocations',
    'fee_message_templates', 'fee_records', 'fee_operations',
    'fee_operation_items', 'payments', 'payment_requests',
    'payment_request_items', 'payment_request_events',
    'payment_provider_deliveries', 'payment_provider_attempts',
    'payment_posting_queue', 'class_schedule_adjustments',
    'class_session_exceptions', 'class_session_staff_snapshots',
    'class_session_student_snapshots', 'class_schedule_adjustment_events',
    'staff_members', 'staff_account_links', 'staff_account_link_events',
    'staff_compensation_rates', 'staff_compensation_rate_events',
    'staff_attendance_entries', 'staff_earning_ledger',
    'staff_payroll_settlements', 'staff_payroll_settlement_items',
    'staff_payroll_settlement_reversals', 'students',
    'student_lifecycle_events'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      -- Append-only audit tables reject UPDATE by design.  A default stamps
      -- their existing rows during ADD COLUMN without mutating history.
      execute format(
        'alter table public.%I add column if not exists workspace_id uuid default %L::uuid',
        table_name, owner_workspace_id::text
      );
      execute format(
        'alter table public.%I alter column workspace_id drop default',
        table_name
      );
      execute format(
        'alter table public.%I alter column workspace_id set not null',
        table_name
      );
    end if;
  end loop;

  -- Each account profile is the authoritative membership record.  A teacher
  -- or admin can therefore belong to one workspace only.
  alter table public.profiles
    add constraint profiles_workspace_fkey
    foreign key (workspace_id) references public.workspaces(id)
    on delete restrict;
end;
$$;

-- fee_message_templates was a global singleton in the first release.  Keep
-- the row id as a human-readable version but scope its primary key by tenant.
alter table public.fee_message_templates
  drop constraint if exists fee_message_templates_singleton_check;
alter table public.fee_message_templates
  drop constraint if exists fee_message_templates_pkey;
alter table public.fee_message_templates
  alter column id type integer;
create sequence if not exists public.fee_message_templates_id_seq;
select setval(
  'public.fee_message_templates_id_seq',
  greatest(coalesce((select max(id) from public.fee_message_templates), 1), 1),
  true
);
alter table public.fee_message_templates
  alter column id set default nextval('public.fee_message_templates_id_seq');
alter table public.fee_message_templates
  add constraint fee_message_templates_pkey primary key (workspace_id);
alter table public.fee_message_templates
  add constraint fee_message_templates_id_check check (id >= 1);

do $$
declare
  table_name text;
  tables constant text[] := array[
    'account_invitations', 'classes', 'class_lifecycle_events',
    'class_schedule_slots', 'class_schedule_slot_staff',
    'class_schedule_slot_teacher_events', 'class_teachers',
    'class_teacher_events', 'enrollments', 'enrollment_slot_selections',
    'enrollment_service_credit_events', 'service_credit_allocations',
    'fee_message_templates', 'fee_records', 'fee_operations',
    'fee_operation_items', 'payments', 'payment_requests',
    'payment_request_items', 'payment_request_events',
    'payment_provider_deliveries', 'payment_provider_attempts',
    'payment_posting_queue', 'class_schedule_adjustments',
    'class_session_exceptions', 'class_session_staff_snapshots',
    'class_session_student_snapshots', 'class_schedule_adjustment_events',
    'staff_members', 'staff_account_links', 'staff_account_link_events',
    'staff_compensation_rates', 'staff_compensation_rate_events',
    'staff_attendance_entries', 'staff_earning_ledger',
    'staff_payroll_settlements', 'staff_payroll_settlement_items',
    'staff_payroll_settlement_reversals', 'students',
    'student_lifecycle_events'
  ];
begin
  foreach table_name in array tables loop
    if to_regclass('public.' || table_name) is null then
      continue;
    end if;
    begin
      execute format(
        'alter table public.%I add constraint %I foreign key (workspace_id) references public.workspaces(id) on delete restrict',
        table_name, table_name || '_workspace_fkey'
      );
    exception when duplicate_object then
      null;
    end;
    execute format(
      'create index if not exists %I on public.%I (workspace_id)',
      table_name || '_workspace_idx', table_name
    );
  end loop;
end;
$$;

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.workspace_id', true), '')::uuid
$$;
revoke all on function public.current_workspace_id() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
    grant execute on function public.current_workspace_id() to tpro_runtime;
  end if;
end;
$$;

create or replace function public.stamp_workspace_id()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  request_workspace uuid;
begin
  request_workspace := public.current_workspace_id();
  if request_workspace is null then
    -- Migration/fixture owners may seed a known single legacy tenant.  The
    -- application runtime never receives this fallback because it must set the
    -- request-local value in resolve_principal().
    if current_user = 'tpro_runtime' then
      raise exception 'workspace context is required for runtime writes';
    end if;
    select id into request_workspace from public.workspaces order by created_at, id limit 1;
  end if;
  if request_workspace is null then
    raise exception 'workspace context is not configured';
  end if;
  if new.workspace_id is null then
    new.workspace_id := request_workspace;
  elsif new.workspace_id <> request_workspace then
    raise exception 'business row belongs to another workspace';
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_workspace_id() from public, anon, authenticated;

do $$
declare
  table_name text;
  tables constant text[] := array[
    'profiles', 'account_invitations', 'classes', 'class_lifecycle_events',
    'class_schedule_slots', 'class_schedule_slot_staff',
    'class_schedule_slot_teacher_events', 'class_teachers',
    'class_teacher_events', 'enrollments', 'enrollment_slot_selections',
    'enrollment_service_credit_events', 'service_credit_allocations',
    'fee_message_templates', 'fee_records', 'fee_operations',
    'fee_operation_items', 'payments', 'payment_requests',
    'payment_request_items', 'payment_request_events',
    'payment_provider_deliveries', 'payment_provider_attempts',
    'payment_posting_queue', 'class_schedule_adjustments',
    'class_session_exceptions', 'class_session_staff_snapshots',
    'class_session_student_snapshots', 'class_schedule_adjustment_events',
    'staff_members', 'staff_account_links', 'staff_account_link_events',
    'staff_compensation_rates', 'staff_compensation_rate_events',
    'staff_attendance_entries', 'staff_earning_ledger',
    'staff_payroll_settlements', 'staff_payroll_settlement_items',
    'staff_payroll_settlement_reversals', 'students',
    'student_lifecycle_events'
  ];
begin
  foreach table_name in array tables loop
    if to_regclass('public.' || table_name) is null then continue; end if;
    execute format('drop trigger if exists %I on public.%I', table_name || '_workspace_stamp', table_name);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.stamp_workspace_id()',
      table_name || '_workspace_stamp', table_name
    );
  end loop;
end;
$$;

-- RLS is a second barrier for any future non-bypass runtime role.  Browser
-- roles retain zero table privileges; the policy is intentionally scoped to
-- tpro_runtime only and is therefore not a Data API surface.
do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
    for table_name in
      select c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind in ('r', 'p')
         and exists (
           select 1 from information_schema.columns col
            where col.table_schema = 'public'
              and col.table_name = c.relname
              and col.column_name = 'workspace_id'
         )
    loop
      execute format('alter table public.%I enable row level security', table_name);
      execute format('alter table public.%I force row level security', table_name);
      execute format('drop policy if exists %I on public.%I', table_name || '_workspace_boundary', table_name);
      execute format(
        'create policy %I on public.%I for all to tpro_runtime using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id())',
        table_name || '_workspace_boundary', table_name
      );
    end loop;
  end if;
end;
$$;

comment on table public.workspaces is
  'One isolated data boundary per administrator account; no business rows are shared across workspaces.';

commit;
