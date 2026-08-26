-- R9.3 — workspace bank settlement settings and Pay2S connection metadata.
--
-- Bank account details are tenant-owned management data. Provider secrets are
-- encrypted by the API before they reach these tables; no browser role gets a
-- grant or an RLS policy for either relation.

begin;

create table if not exists public.workspace_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  bank_code text not null check (char_length(btrim(bank_code)) between 2 and 40),
  bank_name text not null check (char_length(btrim(bank_name)) between 2 and 160),
  account_number text not null check (account_number ~ '^[0-9]{4,30}$'),
  account_name text not null check (char_length(btrim(account_name)) between 2 and 160),
  qr_source_url text,
  provider_account_id text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_payment_accounts_default_uniq
  on public.workspace_payment_accounts (workspace_id)
  where is_default and is_active;
create index if not exists workspace_payment_accounts_workspace_idx
  on public.workspace_payment_accounts (workspace_id, is_active, created_at desc);

create table if not exists public.workspace_payment_providers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('pay2s')),
  status text not null default 'not_configured'
    check (status in ('not_configured', 'pending_verification', 'connected', 'error', 'disabled')),
  plan text not null default 'free'
    check (char_length(btrim(plan)) between 1 and 80),
  merchant_id text,
  api_key_ciphertext text,
  webhook_secret_ciphertext text,
  last_error text,
  connected_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_payment_providers_workspace_provider_uniq
    unique (workspace_id, provider)
);

create or replace function public.workspace_payment_accounts_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.workspace_payment_accounts_updated_at() from public, anon, authenticated;

drop trigger if exists workspace_payment_accounts_workspace_stamp on public.workspace_payment_accounts;
create trigger workspace_payment_accounts_workspace_stamp
before insert or update on public.workspace_payment_accounts
for each row execute function public.stamp_workspace_id();
drop trigger if exists workspace_payment_accounts_updated_at on public.workspace_payment_accounts;
create trigger workspace_payment_accounts_updated_at
before update on public.workspace_payment_accounts
for each row execute function public.workspace_payment_accounts_updated_at();

drop trigger if exists workspace_payment_providers_workspace_stamp on public.workspace_payment_providers;
create trigger workspace_payment_providers_workspace_stamp
before insert or update on public.workspace_payment_providers
for each row execute function public.stamp_workspace_id();
drop trigger if exists workspace_payment_providers_updated_at on public.workspace_payment_providers;
create trigger workspace_payment_providers_updated_at
before update on public.workspace_payment_providers
for each row execute function public.workspace_payment_accounts_updated_at();

alter table public.workspace_payment_accounts enable row level security;
alter table public.workspace_payment_accounts force row level security;
alter table public.workspace_payment_providers enable row level security;
alter table public.workspace_payment_providers force row level security;

revoke all on table public.workspace_payment_accounts from public, anon, authenticated;
revoke all on table public.workspace_payment_providers from public, anon, authenticated;

commit;
