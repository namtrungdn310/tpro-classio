-- Reconcile student-code helper privileges for every supported server runtime
-- role. Migration 055 predated the production `tpro_backend` role, so a
-- database upgraded in that order could read students but could not allocate a
-- code while inserting one. Browser roles remain explicitly denied.
begin;

revoke all on function public.student_code_luhn_check(text)
  from public, anon, authenticated;
revoke all on function public.student_code_from_serial(bigint)
  from public, anon, authenticated;
revoke all on function public.student_code_valid(text)
  from public, anon, authenticated;

do $$
declare
  runtime_role name;
begin
  for runtime_role in
    select rolname
      from pg_roles
     where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    execute format(
      'grant execute on function public.student_code_luhn_check(text) to %I',
      runtime_role
    );
    execute format(
      'grant execute on function public.student_code_from_serial(bigint) to %I',
      runtime_role
    );
    execute format(
      'grant execute on function public.student_code_valid(text) to %I',
      runtime_role
    );
  end loop;
end;
$$;

do $$
declare
  runtime_role name;
begin
  for runtime_role in
    select rolname
      from pg_roles
     where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    if not has_function_privilege(
      runtime_role,
      'public.student_code_luhn_check(text)',
      'execute'
    ) or not has_function_privilege(
      runtime_role,
      'public.student_code_from_serial(bigint)',
      'execute'
    ) or not has_function_privilege(
      runtime_role,
      'public.student_code_valid(text)',
      'execute'
    ) then
      raise exception
        '113 acceptance failed: student-code privileges are incomplete for %',
        runtime_role;
    end if;
  end loop;

  if has_function_privilege(
    'anon',
    'public.student_code_from_serial(bigint)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.student_code_from_serial(bigint)',
    'execute'
  ) then
    raise exception
      '113 acceptance failed: student-code allocation is browser executable';
  end if;
end;
$$;

commit;
