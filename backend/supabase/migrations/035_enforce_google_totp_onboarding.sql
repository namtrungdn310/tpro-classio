-- 035_enforce_google_totp_onboarding.sql
-- Invite-bound onboarding, Google identity/avatar linking and Supabase-native
-- TOTP MFA. Sensitive tables are backend-only; browser roles receive no grants.

begin;

alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists totp_enrolled_at timestamptz,
  add column if not exists avatar_url text,
  add column if not exists avatar_synced_at timestamptz;

alter table public.user_device_sessions
  add column if not exists aal text not null default 'aal1',
  add column if not exists mfa_factor_id text,
  add column if not exists mfa_verified_at timestamptz;

alter table public.user_device_sessions
  drop constraint if exists user_device_sessions_aal_check;
alter table public.user_device_sessions
  add constraint user_device_sessions_aal_check check (aal in ('aal1', 'aal2'));

create table if not exists public.account_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  role public.user_role not null default 'viewer',
  invited_by uuid not null references public.profiles(id) on delete restrict,
  registered_user_id uuid unique references auth.users(id) on delete cascade,
  registration_started_at timestamptz,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invitation_email_normalized check (email = lower(btrim(email))),
  constraint invitation_role_viewer check (role = 'viewer'),
  constraint invitation_single_use check (num_nonnulls(consumed_at, revoked_at) <= 1),
  constraint invitation_registration_pair check (
    (registered_user_id is null and registration_started_at is null)
    or (registered_user_id is not null and registration_started_at is not null)
  )
);

create index if not exists idx_invitations_email_state
  on public.account_invitations (lower(email), consumed_at, revoked_at, expires_at);
create index if not exists idx_invitations_registered_user
  on public.account_invitations (registered_user_id)
  where registered_user_id is not null;

alter table public.account_invitations enable row level security;
alter table public.account_invitations force row level security;
revoke all on public.account_invitations from public, anon, authenticated;

-- Opaque, short-lived pre-auth session. Upstream credentials and OAuth PKCE
-- material are encrypted by the application with AUTH_ENCRYPTION_KEY.
create table if not exists public.auth_flow_sessions (
  id uuid primary key default gen_random_uuid(),
  session_token_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  invitation_id uuid references public.account_invitations(id) on delete set null,
  flow_type text not null,
  completed_steps text[] not null default '{}',
  aal text not null default 'aal1',
  supabase_access_token_ciphertext text not null,
  supabase_refresh_token_ciphertext text not null,
  oauth_state_hash text,
  oauth_nonce_ciphertext text,
  oauth_pkce_verifier_ciphertext text,
  oauth_started_at timestamptz,
  oauth_consumed_at timestamptz,
  recovery_codes_ciphertext text,
  recovery_codes_retrieved_at timestamptz,
  recovery_codes_confirmed_at timestamptz,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint auth_flow_sessions_flow_type_check
    check (flow_type in ('onboarding', 'login_mfa')),
  constraint auth_flow_sessions_aal_check check (aal in ('aal1', 'aal2')),
  constraint auth_flow_sessions_email_normalized check (email = lower(btrim(email))),
  constraint auth_flow_sessions_expiry_check check (expires_at > created_at),
  constraint auth_flow_sessions_user_type_unique unique (user_id, flow_type)
);

-- Do not use now() in an index predicate: PostgreSQL requires immutable
-- predicate functions. Expiry remains in the lookup condition.
create index if not exists idx_flow_sessions_token
  on public.auth_flow_sessions (session_token_hash, expires_at);
create index if not exists idx_flow_sessions_user
  on public.auth_flow_sessions (user_id, flow_type, expires_at);

alter table public.auth_flow_sessions enable row level security;
alter table public.auth_flow_sessions force row level security;
revoke all on public.auth_flow_sessions from public, anon, authenticated;

-- Supabase Auth owns TOTP secrets and replay protection. The application keeps
-- only the non-secret provider factor id and local verification timestamp.
create table if not exists public.auth_totp_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  provider_factor_id text not null unique,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  last_used_at timestamptz
);

create index if not exists idx_totp_factors_user on public.auth_totp_factors (user_id);
alter table public.auth_totp_factors enable row level security;
alter table public.auth_totp_factors force row level security;
revoke all on public.auth_totp_factors from public, anon, authenticated;

create table if not exists public.auth_google_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  google_sub text not null unique,
  google_email text not null,
  provider_refresh_token_ciphertext text not null,
  avatar_object_path text,
  avatar_source_url text,
  avatar_synced_at timestamptz not null,
  linked_at timestamptz not null default now(),
  constraint google_identity_email_normalized
    check (google_email = lower(btrim(google_email)))
);

-- Google OIDC defines `picture` as optional. Do not block identity/MFA
-- onboarding when the account must use the UI's initials fallback.
alter table public.auth_google_identities
  alter column avatar_object_path drop not null;

create index if not exists idx_google_identity_user
  on public.auth_google_identities (user_id);
create index if not exists idx_google_identity_avatar_sync
  on public.auth_google_identities (avatar_synced_at);
alter table public.auth_google_identities enable row level security;
alter table public.auth_google_identities force row level security;
revoke all on public.auth_google_identities from public, anon, authenticated;

create table if not exists public.auth_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);

create index if not exists idx_recovery_codes_user_active
  on public.auth_recovery_codes (user_id) where used_at is null;
alter table public.auth_recovery_codes enable row level security;
alter table public.auth_recovery_codes force row level security;
revoke all on public.auth_recovery_codes from public, anon, authenticated;

alter table public.account_security_events
  drop constraint if exists account_security_events_action_check;
alter table public.account_security_events
  add constraint account_security_events_action_check check (action in (
    'username_changed',
    'role_changed',
    'account_approved',
    'account_disabled',
    'account_reactivated',
    'totp_enrolled',
    'totp_reset',
    'google_linked',
    'onboarding_completed',
    'recovery_codes_generated',
    'recovery_code_used'
  ));

commit;
