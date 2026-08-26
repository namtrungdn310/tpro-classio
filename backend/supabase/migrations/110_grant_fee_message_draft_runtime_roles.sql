-- The migration owner creates the secured group-draft table, while the API
-- connects as a dedicated runtime role. Grant only the CRUD surface required
-- by the server; browser roles and PUBLIC remain fully revoked by migration 108.
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
    execute format(
      'grant select, insert, update, delete on table public.fee_message_drafts to %I',
      runtime_role
    );
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1
      from pg_roles role_
     where role_.rolname in ('tpro_backend', 'tpro_runtime')
       and not has_table_privilege(
         role_.rolname,
         'public.fee_message_drafts',
         'select,insert,update,delete'
       )
  ) then
    raise exception '110 acceptance failed: runtime draft privileges are incomplete';
  end if;
end;
$$;

commit;
