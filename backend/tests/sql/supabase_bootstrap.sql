-- Bootstrap fixture Supabase cho PostgreSQL disposable (idempotent).
-- Roles là GLOBAL trên cluster: tạo có điều kiện. Schema/bảng là per-DB:
-- dùng IF NOT EXISTS để chạy được trên nhiều database cùng cluster.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  deleted_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb
);

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade
);

-- Minimal Supabase Storage contract needed by the avatar hardening migration.
-- Production uses the provider-owned storage schema; this table only makes
-- the security invariant executable in isolated PostgreSQL CI.
create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id) on delete cascade,
  name text not null
);

-- Hosted Supabase enables RLS on provider-owned Storage tables. Mirror that
-- security boundary without changing ownership in this isolated CI fixture.
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
