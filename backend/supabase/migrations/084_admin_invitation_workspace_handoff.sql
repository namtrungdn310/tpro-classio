-- R9.2 — allow the one intentional cross-workspace hand-off.
--
-- Creating an admin invitation reserves a new owner-less workspace while the
-- inviter is still operating in their own workspace.  Every other business
-- write remains strictly request-workspace scoped.  The trigger validates the
-- hand-off instead of allowing arbitrary cross-tenant rows.

begin;

-- Migration 035 left a viewer-only check behind.  Migration 070 added the
-- forward role/staff invariant but did not remove that legacy constraint,
-- which would make the first valid admin invitation fail at the database
-- boundary.  Remove only the obsolete constraint; the validated 070 check is
-- the canonical role policy.
alter table public.account_invitations
  drop constraint if exists invitation_role_viewer;

create or replace function public.stamp_workspace_id()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  request_workspace uuid;
  target_owner uuid;
  inviter_workspace uuid;
begin
  request_workspace := public.current_workspace_id();
  if request_workspace is null then
    if current_user = 'tpro_runtime' then
      raise exception 'workspace context is required for runtime writes';
    end if;
    select id into request_workspace
      from public.workspaces
     order by created_at, id
     limit 1;
  end if;
  if request_workspace is null then
    raise exception 'workspace context is not configured';
  end if;

  -- NEW is a polymorphic trigger record. Do not reference NEW.role in the
  -- outer predicate: account_invitations is the only scoped table with that
  -- column and PostgreSQL otherwise raises "record new has no field role"
  -- while the trigger fires for profiles/audit rows.
  if tg_table_name = 'account_invitations' then
    if coalesce(to_jsonb(new)->>'role', '') = 'admin'
       and new.workspace_id is not null
       and new.workspace_id <> request_workspace then
      select owner_user_id into target_owner
        from public.workspaces
       where id = new.workspace_id
       for update;
      select workspace_id into inviter_workspace
        from public.profiles
       where id = new.invited_by;
      if target_owner is not null
         or inviter_workspace is distinct from request_workspace then
        raise exception 'admin invitation workspace hand-off is not valid';
      end if;
      return new;
    end if;
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
begin
  if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
    grant execute on function public.stamp_workspace_id() to tpro_runtime;
  end if;
end;
$$;

commit;
