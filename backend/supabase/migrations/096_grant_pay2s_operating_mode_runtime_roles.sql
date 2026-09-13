-- 096 — allow both supported application runtime roles to read/write the
-- Dev-only Pay2S operating-mode boundary. Browser roles and PUBLIC remain
-- denied; the FastAPI router still requires the effective Dev role.

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
      'grant execute on function ops.platform_pay2s_mode() to %I',
      runtime_role
    );
    execute format(
      'grant execute on function ops.platform_pay2s_setting() to %I',
      runtime_role
    );
    execute format(
      'grant execute on function ops.set_platform_pay2s_mode(text, uuid) to %I',
      runtime_role
    );
  end loop;
end;
$$;

revoke all on function ops.platform_pay2s_mode() from public, anon, authenticated;
revoke all on function ops.platform_pay2s_setting() from public, anon, authenticated;
revoke all on function ops.set_platform_pay2s_mode(text, uuid) from public, anon, authenticated;

commit;
