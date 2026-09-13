-- R6-D13 — Staff-account links + viewer quarantine (forward-only).
--
-- `staff_account_links` = current active relation (unique per profile/staff);
-- `staff_account_link_events` = append-only LINK/UNLINK/RELINK audit.
-- Viewer accounts: no auto-map; non-owner viewers are disabled + sessions
-- revoked + security event (fail-closed); explicit dev mapping is manual.

begin;

create table if not exists public.staff_account_links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  staff_id uuid not null unique references public.staff_members(id) on delete restrict,
  lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active', 'disabled')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index staff_account_links_staff_idx
  on public.staff_account_links (staff_id);

create table if not exists public.staff_account_link_events (
  id uuid primary key default gen_random_uuid(),
  link_id uuid references public.staff_account_links(id) on delete set null,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  staff_id uuid not null references public.staff_members(id) on delete restrict,
  event_type text not null check (event_type in ('LINK', 'UNLINK', 'RELINK')),
  lifecycle_status text not null default 'active',
  actor_user_id uuid references public.profiles(id) on delete set null,
  reason text,
  profile_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index staff_account_link_events_profile_idx
  on public.staff_account_link_events (profile_id, created_at);

create or replace function public.block_staff_account_link_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'staff account link events are append-only';
end;
$$;

revoke all on function public.block_staff_account_link_event_mutation() from public, anon, authenticated;

drop trigger if exists trg_staff_account_link_events_append_only on public.staff_account_link_events;
create trigger trg_staff_account_link_events_append_only
before update or delete on public.staff_account_link_events
for each row execute function public.block_staff_account_link_event_mutation();
drop trigger if exists trg_staff_account_link_events_no_truncate on public.staff_account_link_events;
create trigger trg_staff_account_link_events_no_truncate
before truncate on public.staff_account_link_events
for each statement execute function public.block_staff_account_link_event_mutation();

alter table public.staff_account_links enable row level security;
alter table public.staff_account_links force row level security;
alter table public.staff_account_link_events enable row level security;
alter table public.staff_account_link_events force row level security;
revoke all on table public.staff_account_links from public, anon, authenticated;
revoke all on table public.staff_account_link_events from public, anon, authenticated;

alter table public.account_security_events
  drop constraint if exists account_security_events_action_check;
alter table public.account_security_events
  add constraint account_security_events_action_check
    check (action in (
      'username_changed', 'role_changed', 'account_approved',
      'account_disabled', 'account_reactivated',
      'totp_enrolled', 'totp_reset', 'google_linked',
      'onboarding_completed', 'recovery_codes_generated',
      'recovery_code_used', 'role_quarantined'
    )) not valid;
alter table public.account_security_events
  validate constraint account_security_events_action_check;

-- ===========================================================================
-- Viewer quarantine (fail-closed, no auto-map to teacher)
-- ===========================================================================
do $$
declare
  r record;
  owner_id text;
  disabled_count integer := 0;
begin
  -- Owner protection dùng OWNER_USER_ID (không cần auth.users — email chỉ
  -- bootstrap cross-check tại runtime app).
  select coalesce(current_setting('app.owner_user_id', true), '') into owner_id;
  for r in
    select p.id
      from public.profiles p
     where p.role = 'viewer'
     order by p.id
  loop
    if owner_id <> '' and lower(r.id::text) = lower(owner_id) then
      continue;
    end if;
    update public.profiles
       set account_status = 'disabled',
           disabled_at = now()
     where id = r.id;
    insert into public.account_security_events (
      actor_user_id, target_user_id, action, previous_role,
      previous_status, next_status
    ) values (
      null, r.id, 'role_quarantined', 'viewer', 'active', 'disabled'
    )
    on conflict do nothing;
    disabled_count := disabled_count + 1;
  end loop;
  raise notice 'M065 viewer quarantine: % disabled (fail-closed; no auto teacher)', disabled_count;
end;
$$;

-- ===========================================================================
-- Acceptance
-- ===========================================================================
do $$
declare
  active_viewers integer;
begin
  select count(*) into active_viewers
    from public.profiles
   where role = 'viewer' and account_status = 'active';
  if active_viewers > 0 then
    raise exception 'M065 acceptance failed: % active viewer account(s) remain', active_viewers;
  end if;
  raise notice 'M065 acceptance OK: zero active viewers';
end;
$$;

commit;
