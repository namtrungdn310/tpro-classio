create table if not exists user_device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  device_type text not null check (device_type in ('desktop', 'mobile')),
  device_id_hash text not null,
  refresh_token_hash text not null,
  session_nonce text not null,
  supabase_session_id text,
  user_agent_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint uq_user_device_sessions_slot unique (user_id, device_type)
);

create index if not exists idx_user_device_sessions_refresh_hash
  on user_device_sessions(refresh_token_hash);

create index if not exists idx_user_device_sessions_user_id
  on user_device_sessions(user_id);

drop trigger if exists user_device_sessions_updated_at on user_device_sessions;

create trigger user_device_sessions_updated_at
before update on user_device_sessions
for each row execute function set_updated_at();
