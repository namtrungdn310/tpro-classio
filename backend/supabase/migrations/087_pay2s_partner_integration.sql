-- R9.4 — Pay2S Partner API contract.
--
-- Pay2S Partner uses Access Key/Secret Key to mint a short-lived bearer
-- token.  Each registered webhook has its own bearer token and is attached
-- to one Pay2S bank.  Secrets remain encrypted in the API; the database only
-- stores a keyed hash for constant-time webhook lookup.

begin;

alter table public.workspace_payment_providers
  add column if not exists connection_mode text not null default 'byo',
  add column if not exists access_key_ciphertext text,
  add column if not exists secret_key_ciphertext text,
  add column if not exists bearer_token_ciphertext text,
  add column if not exists bearer_token_expires_at timestamptz,
  add column if not exists partner_code text,
  add column if not exists collection_partner_code text,
  add column if not exists webhook_url text;

alter table public.workspace_payment_providers
  drop constraint if exists workspace_payment_providers_connection_mode_check;
alter table public.workspace_payment_providers
  add constraint workspace_payment_providers_connection_mode_check
  check (connection_mode in ('central', 'byo'));

-- Preserve data written by the initial scaffold while moving to the names used
-- by the official Partner API contract.  The old columns are intentionally
-- retained for a rolling migration and are no longer read by application code.
update public.workspace_payment_providers
set access_key_ciphertext = coalesce(access_key_ciphertext, api_key_ciphertext)
where access_key_ciphertext is null and api_key_ciphertext is not null;

alter table public.workspace_payment_accounts
  add column if not exists provider_bank_id text,
  add column if not exists va_number text,
  add column if not exists provider_status text not null default 'manual',
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb,
  add column if not exists last_synced_at timestamptz;

create index if not exists workspace_payment_accounts_provider_bank_idx
  on public.workspace_payment_accounts (workspace_id, provider_bank_id)
  where provider_bank_id is not null;

create table if not exists public.workspace_payment_webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_id uuid not null references public.workspace_payment_providers(id) on delete cascade,
  bank_account_id uuid not null references public.workspace_payment_accounts(id) on delete cascade,
  provider_webhook_id text,
  webhook_type text not null default 'IN'
    check (webhook_type in ('IN', 'OUT', 'ALL')),
  webhook_url text not null,
  webhook_token_ciphertext text,
  webhook_token_hash text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'disabled', 'error')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_payment_webhooks_provider_bank_uniq
    unique (provider_id, bank_account_id),
  constraint workspace_payment_webhooks_token_hash_uniq
    unique (webhook_token_hash)
);

create index if not exists workspace_payment_webhooks_workspace_idx
  on public.workspace_payment_webhooks (workspace_id, status);

create or replace function public.workspace_payment_webhooks_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.workspace_payment_webhooks_updated_at() from public, anon, authenticated;

drop trigger if exists workspace_payment_webhooks_workspace_stamp
  on public.workspace_payment_webhooks;
create trigger workspace_payment_webhooks_workspace_stamp
before insert or update on public.workspace_payment_webhooks
for each row execute function public.stamp_workspace_id();

drop trigger if exists workspace_payment_webhooks_updated_at
  on public.workspace_payment_webhooks;
create trigger workspace_payment_webhooks_updated_at
before update on public.workspace_payment_webhooks
for each row execute function public.workspace_payment_webhooks_updated_at();

alter table public.workspace_payment_webhooks enable row level security;
alter table public.workspace_payment_webhooks force row level security;
revoke all on table public.workspace_payment_webhooks from public, anon, authenticated;

commit;
