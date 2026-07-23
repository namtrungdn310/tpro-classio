create table if not exists password_reset_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  access_token_ciphertext text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_sessions_expires_at
  on password_reset_sessions (expires_at);

alter table password_reset_sessions enable row level security;
alter table password_reset_sessions force row level security;
revoke all privileges on table password_reset_sessions from anon, authenticated;

create table if not exists auth_rate_limits (
  scope text not null,
  subject_hash text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count > 0),
  expires_at timestamptz not null,
  primary key (scope, subject_hash, window_started_at)
);

create index if not exists idx_auth_rate_limits_expires_at
  on auth_rate_limits (expires_at);

alter table auth_rate_limits enable row level security;
alter table auth_rate_limits force row level security;
revoke all privileges on table auth_rate_limits from anon, authenticated;
