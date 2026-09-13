-- R9.1 — close the last tenant-boundary gaps left by 082.
--
-- Security/audit events and the immutable student-code registry are business
-- data too.  They must be scoped to the same administrator workspace as the
-- profile/student they describe.  This migration is forward-only and is safe
-- to rerun after a successful 082.

begin;

do $$
declare
  owner_workspace_id uuid;
  table_name text;
begin
  select w.id into owner_workspace_id
    from public.workspaces w
   order by w.created_at, w.id
   limit 1;
  if owner_workspace_id is null then
    raise exception 'M083 abort: migration 082 must create a workspace first';
  end if;

  foreach table_name in array array['account_security_events', 'student_code_registry'] loop
    if to_regclass('public.' || table_name) is null then
      raise exception 'M083 abort: required table % is missing', table_name;
    end if;
    execute format(
      'alter table public.%I add column if not exists workspace_id uuid default %L::uuid',
      table_name, owner_workspace_id::text
    );
    execute format(
      'alter table public.%I alter column workspace_id drop default', table_name
    );
    execute format(
      'alter table public.%I alter column workspace_id set not null', table_name
    );
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
    if current_user = 'tpro_runtime' then
      raise exception 'workspace context is required for runtime writes';
    end if;
    select id into request_workspace
      from public.workspaces order by created_at, id limit 1;
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

drop trigger if exists account_security_events_workspace_stamp
  on public.account_security_events;
create trigger account_security_events_workspace_stamp
before insert or update on public.account_security_events
for each row execute function public.stamp_workspace_id();

drop trigger if exists student_code_registry_workspace_stamp
  on public.student_code_registry;
create trigger student_code_registry_workspace_stamp
before insert or update on public.student_code_registry
for each row execute function public.stamp_workspace_id();

do $$
declare
  table_name text;
begin
  foreach table_name in array array['account_security_events', 'student_code_registry'] loop
    alter table public.account_security_events enable row level security;
    alter table public.account_security_events force row level security;
    alter table public.student_code_registry enable row level security;
    alter table public.student_code_registry force row level security;
    if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
      execute format('drop policy if exists %I on public.%I',
        table_name || '_workspace_boundary', table_name);
      execute format(
        'create policy %I on public.%I for all to tpro_runtime using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id())',
        table_name || '_workspace_boundary', table_name
      );
    end if;
  end loop;
end;
$$;

comment on column public.account_security_events.workspace_id is
  'Administrator workspace owning this immutable security event.';
comment on column public.student_code_registry.workspace_id is
  'Administrator workspace owning this immutable student-code reservation.';

commit;
