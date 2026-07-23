-- TPRO Classio serves business data exclusively through the trusted FastAPI
-- backend. Supabase Auth remains available through /auth/v1, but browser roles
-- must not reach public tables or RPC functions through the Data API.

begin;

do $$
declare
  target record;
begin
  -- Supabase exposes public through its Data API. Fail closed for every
  -- project-owned table, including tables added by future migrations.
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.refclassid = 'pg_extension'::regclass
          and d.deptype = 'e'
      )
  loop
    execute format(
      'alter table %I.%I enable row level security',
      target.schema_name,
      target.table_name
    );
    execute format(
      'alter table %I.%I force row level security',
      target.schema_name,
      target.table_name
    );
    execute format(
      'revoke all privileges on table %I.%I from public, anon, authenticated',
      target.schema_name,
      target.table_name
    );
  end loop;

  -- The application currently has no public views. If one is introduced for
  -- backend use, it must not inherit Data API grants either.
  for target in
    select n.nspname as schema_name, c.relname as relation_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm', 'f')
  loop
    execute format(
      'revoke all privileges on table %I.%I from public, anon, authenticated',
      target.schema_name,
      target.relation_name
    );
  end loop;

  -- REVOKE at table level does not remove an explicit column grant. Remove
  -- those separately (profiles previously granted two UPDATE columns).
  for target in
    select distinct
      table_schema,
      table_name,
      column_name,
      privilege_type,
      grantee
    from information_schema.column_privileges
    where table_schema = 'public'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  loop
    execute format(
      'revoke %s (%I) on table %I.%I from %I',
      target.privilege_type,
      target.column_name,
      target.table_schema,
      target.table_name,
      target.grantee
    );
  end loop;

  -- Authorization is enforced by FastAPI. Leaving old browser policies in
  -- place would make an accidental future GRANT reopen the Data API surface.
  for target in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format(
      'drop policy %I on %I.%I',
      target.policyname,
      target.schemaname,
      target.tablename
    );
  end loop;

  -- Do not expose project-owned helper/trigger functions as RPC endpoints.
  -- Extension-owned functions are left to their extension lifecycle.
  for target in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.refclassid = 'pg_extension'::regclass
          and d.deptype = 'e'
      )
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      target.schema_name,
      target.function_name,
      target.identity_arguments
    );
  end loop;
end
$$;

revoke all privileges on all sequences in schema public
  from public, anon, authenticated;

-- Trigger functions do not need object lookup through a mutable schema. Pinning
-- pg_catalog removes search-path shadowing and clears the corresponding
-- Security Advisor finding for both ordinary and SECURITY DEFINER functions.
do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    alter function public.set_updated_at() set search_path = pg_catalog;
  end if;

  if to_regprocedure('public.protect_payment_ledger_entry()') is not null then
    alter function public.protect_payment_ledger_entry()
      set search_path = pg_catalog;
  end if;
end
$$;

-- Prevent objects created by the migration owner from automatically receiving
-- Supabase's broad browser-role defaults. RLS still needs to be enabled for
-- every new table; verify_security.sql enforces that release gate.
alter default privileges in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges in schema public
  revoke all privileges on sequences from anon, authenticated;
-- PostgreSQL grants EXECUTE on new functions to PUBLIC globally by default.
-- A schema-scoped REVOKE cannot cancel that built-in global grant.
alter default privileges
  revoke execute on functions from public;
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

-- This SECURITY DEFINER helper existed only for the removed browser policies.
drop function if exists public.is_admin();

commit;
