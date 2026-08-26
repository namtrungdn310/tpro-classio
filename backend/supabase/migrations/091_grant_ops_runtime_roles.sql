-- 091 — grant the Dev operations control plane to the production runtime role.
-- Migration 089 granted the disposable `tpro_runtime` role. Production uses
-- `tpro_backend`; browser roles and PUBLIC must remain denied.

begin;

do $$
declare
  runtime_role name;
begin
  for runtime_role in
    select rolname
      from pg_roles
     where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    execute format('grant usage on schema ops to %I', runtime_role);
    execute format(
      'grant execute on function ops.platform_overview() to %I',
      runtime_role
    );
    execute format(
      'grant execute on function ops.disable_workspace_pay2s(uuid, uuid, text) to %I',
      runtime_role
    );
  end loop;
end;
$$;

commit;
