-- Keep account-security history auditable while allowing a Supabase Auth user
-- to be permanently deleted and later register again with the same email.

begin;

alter table public.account_security_events
  add column if not exists actor_email_snapshot text,
  add column if not exists actor_username_snapshot text,
  add column if not exists target_email_snapshot text,
  add column if not exists target_username_snapshot text;

-- The existing append-only trigger intentionally blocks UPDATE. Disable it only
-- for the one-time snapshot backfill, then install a stricter replacement below.
alter table public.account_security_events
  disable trigger account_security_events_append_only;

update public.account_security_events as event
set
  actor_email_snapshot = coalesce(
    event.actor_email_snapshot,
    (select auth_user.email from auth.users as auth_user where auth_user.id = event.actor_user_id)
  ),
  actor_username_snapshot = coalesce(
    event.actor_username_snapshot,
    (select profile.username from public.profiles as profile where profile.id = event.actor_user_id)
  ),
  target_email_snapshot = coalesce(
    event.target_email_snapshot,
    (select auth_user.email from auth.users as auth_user where auth_user.id = event.target_user_id)
  ),
  target_username_snapshot = coalesce(
    event.target_username_snapshot,
    (select profile.username from public.profiles as profile where profile.id = event.target_user_id),
    event.next_username,
    event.previous_username
  );

alter table public.account_security_events
  enable trigger account_security_events_append_only;

-- Capture immutable identity snapshots in the database rather than requiring
-- the API and migration to be deployed at exactly the same instant. Existing
-- API versions keep using the original INSERT shape; this trigger enriches new
-- events as soon as this migration is active.
create or replace function public.populate_account_security_event_snapshots()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  new.actor_email_snapshot := coalesce(
    new.actor_email_snapshot,
    (select auth_user.email from auth.users as auth_user where auth_user.id = new.actor_user_id)
  );
  new.actor_username_snapshot := coalesce(
    new.actor_username_snapshot,
    (select profile.username from public.profiles as profile where profile.id = new.actor_user_id)
  );
  new.target_email_snapshot := coalesce(
    new.target_email_snapshot,
    (select auth_user.email from auth.users as auth_user where auth_user.id = new.target_user_id)
  );
  new.target_username_snapshot := coalesce(
    new.target_username_snapshot,
    (select profile.username from public.profiles as profile where profile.id = new.target_user_id),
    new.next_username,
    new.previous_username
  );
  return new;
end;
$$;

revoke all on function public.populate_account_security_event_snapshots()
  from public, anon, authenticated;

drop trigger if exists account_security_events_snapshot_insert
  on public.account_security_events;

create trigger account_security_events_snapshot_insert
before insert on public.account_security_events
for each row execute function public.populate_account_security_event_snapshots();

alter table public.profiles
  drop constraint if exists profiles_approved_by_fkey,
  drop constraint if exists profiles_disabled_by_fkey;

alter table public.profiles
  add constraint profiles_approved_by_fkey
    foreign key (approved_by) references public.profiles(id) on delete set null,
  add constraint profiles_disabled_by_fkey
    foreign key (disabled_by) references public.profiles(id) on delete set null;

alter table public.account_security_events
  alter column target_user_id drop not null,
  drop constraint if exists account_security_events_actor_user_id_fkey,
  drop constraint if exists account_security_events_target_user_id_fkey;

alter table public.account_security_events
  add constraint account_security_events_actor_user_id_fkey
    foreign key (actor_user_id) references public.profiles(id) on delete set null,
  add constraint account_security_events_target_user_id_fkey
    foreign key (target_user_id) references public.profiles(id) on delete set null;

create or replace function public.protect_account_security_event()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  -- Account deletion may anonymize only actor/target foreign keys. The event
  -- payload and immutable identity snapshots must remain byte-for-byte intact.
  if tg_op = 'UPDATE'
    and new.id is not distinct from old.id
    and new.action is not distinct from old.action
    and new.previous_role is not distinct from old.previous_role
    and new.next_role is not distinct from old.next_role
    and new.previous_status is not distinct from old.previous_status
    and new.next_status is not distinct from old.next_status
    and new.previous_username is not distinct from old.previous_username
    and new.next_username is not distinct from old.next_username
    and new.actor_email_snapshot is not distinct from old.actor_email_snapshot
    and new.actor_username_snapshot is not distinct from old.actor_username_snapshot
    and new.target_email_snapshot is not distinct from old.target_email_snapshot
    and new.target_username_snapshot is not distinct from old.target_username_snapshot
    and new.created_at is not distinct from old.created_at
    and (
      new.actor_user_id is not distinct from old.actor_user_id
      or (old.actor_user_id is not null and new.actor_user_id is null)
    )
    and (
      new.target_user_id is not distinct from old.target_user_id
      or (old.target_user_id is not null and new.target_user_id is null)
    )
    and (
      new.actor_user_id is distinct from old.actor_user_id
      or new.target_user_id is distinct from old.target_user_id
    ) then
    return new;
  end if;

  raise exception 'account security events are append-only'
    using errcode = '55000';
end;
$$;

revoke all on function public.protect_account_security_event()
  from public, anon, authenticated;

commit;
