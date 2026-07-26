-- Keep Google avatars private even if the Storage dashboard was configured
-- incorrectly. Browsers fetch avatars only through the authenticated BFF/API.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Supabase Storage tables are required for private avatars';
  end if;
end
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'avatars',
  'avatars',
  false,
  5242880,
  array['image/webp']::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The backend uses the service-role Storage API. Browser database roles must
-- not bypass the authenticated avatar proxy through direct Storage queries.
revoke all on table storage.buckets from public, anon, authenticated;
revoke all on table storage.objects from public, anon, authenticated;

-- Table-level REVOKE does not remove an explicit column grant.  Remove those
-- grants as well so a provider-side ACL change cannot expose object metadata
-- through a single column.
do $$
declare
  target record;
  grantee_sql text;
begin
  for target in
    select distinct
      table_schema,
      table_name,
      column_name,
      privilege_type,
      grantee
    from information_schema.column_privileges
    where table_schema = 'storage'
      and table_name in ('buckets', 'objects')
      and grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  loop
    grantee_sql := case
      when target.grantee = 'PUBLIC' then 'PUBLIC'
      else quote_ident(target.grantee)
    end;
    execute format(
      'revoke %s (%I) on table %I.%I from %s',
      target.privilege_type,
      target.column_name,
      target.table_schema,
      target.table_name,
      grantee_sql
    );
  end loop;
end
$$;

commit;
