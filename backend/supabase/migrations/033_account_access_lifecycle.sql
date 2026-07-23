-- Require explicit owner approval before a newly registered account can read
-- TPRO business data. Account identities are retained for financial audit;
-- access is revoked through lifecycle state instead of destructive deletion.

begin;

alter table public.profiles
  add column if not exists account_status text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid;

-- The legacy registration flow created viewer profiles before OTP verification.
-- Treating every existing profile as active would therefore approve abandoned or
-- unverified registrations. Existing admins were explicitly trusted by the old
-- owner-only role workflow; every legacy viewer must be reviewed once by Dev.
update public.profiles
set account_status = case
  when role = 'admin' then 'active'
  else 'pending'
end
where account_status is null;

alter table public.profiles
  alter column account_status set default 'pending',
  alter column account_status set not null;

alter table public.profiles
  drop constraint if exists profiles_account_status_check,
  add constraint profiles_account_status_check
    check (account_status in ('pending', 'active', 'disabled'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_approved_by_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_approved_by_fkey
      foreign key (approved_by) references public.profiles(id) on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_disabled_by_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_disabled_by_fkey
      foreign key (disabled_by) references public.profiles(id) on delete restrict;
  end if;
end
$$;

create index if not exists idx_profiles_account_lifecycle
  on public.profiles (account_status, created_at desc, id);

create table if not exists public.account_security_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete restrict,
  target_user_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  previous_role public.user_role,
  next_role public.user_role,
  previous_status text,
  next_status text,
  previous_username text,
  next_username text,
  created_at timestamptz not null default now(),
  constraint account_security_events_action_check
    check (action in (
      'username_changed',
      'role_changed',
      'account_approved',
      'account_disabled',
      'account_reactivated'
    )),
  constraint account_security_events_previous_status_check
    check (previous_status is null or previous_status in ('pending', 'active', 'disabled')),
  constraint account_security_events_next_status_check
    check (next_status is null or next_status in ('pending', 'active', 'disabled'))
);

alter table public.account_security_events
  add column if not exists previous_username text,
  add column if not exists next_username text;

create index if not exists idx_account_security_events_target_time
  on public.account_security_events (target_user_id, created_at desc);

create or replace function public.protect_account_security_event()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'account security events are append-only';
end
$$;

drop trigger if exists account_security_events_append_only
  on public.account_security_events;
create trigger account_security_events_append_only
before update or delete on public.account_security_events
for each row execute function public.protect_account_security_event();

alter table public.account_security_events enable row level security;
alter table public.account_security_events force row level security;
revoke all privileges on table public.account_security_events
  from public, anon, authenticated;
revoke execute on function public.protect_account_security_event()
  from public, anon, authenticated;

commit;
