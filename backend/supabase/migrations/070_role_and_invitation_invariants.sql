-- R7-D02 / R7-D04 — Role and Invitation Invariants (forward-only).
--
-- 1. Eliminate runtime `viewer` role;
-- 2. Add `staff_id` reservation on `account_invitations`;
-- 3. Enforce constraint: teacher invite requires staff_id, admin invite requires null staff_id;
-- 4. Stable partial unique index on active teacher invitations by staff_id (no volatile time expressions);
-- 5. Revoke any pending viewer invitations;
-- 6. Enable & force RLS; least-privilege permissions.

begin;

-- ===========================================================================
-- 1. Preflight: Check for active viewer profiles
-- ===========================================================================
do $$
declare
  active_viewers integer;
begin
  select count(*) into active_viewers
    from public.profiles
   where role = 'viewer' and account_status = 'active';
  if active_viewers > 0 then
    raise exception '070 preflight abort: % active viewer profile(s) found. All viewers must be quarantined or mapped before migration.', active_viewers;
  end if;
end;
$$;

-- ===========================================================================
-- 2. Add staff_id reservation to account_invitations
-- ===========================================================================
alter table public.account_invitations
  add column if not exists staff_id uuid references public.staff_members(id) on delete restrict;

create index if not exists account_invitations_staff_idx
  on public.account_invitations (staff_id);

-- Preserve legacy viewer rows as revoked audit evidence before the new
-- runtime-only role constraint is validated.
update public.account_invitations
   set revoked_at = now()
 where role = 'viewer' and consumed_at is null and revoked_at is null;

-- Check constraint for role and staff_id pairing. A viewer row is historical
-- evidence only and can never become an active invitation again.
alter table public.account_invitations
  drop constraint if exists account_invitations_role_staff_check;

alter table public.account_invitations
  add constraint account_invitations_role_staff_check
  check (
    (role = 'teacher' and staff_id is not null) or
    (role = 'admin' and staff_id is null) or
    (role = 'viewer' and (revoked_at is not null or consumed_at is not null))
  ) not valid;

alter table public.account_invitations
  validate constraint account_invitations_role_staff_check;

-- Stable partial unique index for active teacher invitations
-- (Predicate is strictly stable: consumed_at is null and revoked_at is null)
create unique index if not exists account_invitations_active_teacher_staff_uniq
  on public.account_invitations (staff_id)
  where role = 'teacher' and consumed_at is null and revoked_at is null;

-- ===========================================================================
-- 3. Viewer invitations were revoked before constraint validation above.
-- ===========================================================================
-- Remove legacy default role from profiles
alter table public.profiles alter column role drop default;

-- ===========================================================================
-- 4. RLS and Grants
-- ===========================================================================
alter table public.account_invitations enable row level security;
alter table public.account_invitations force row level security;
revoke all on table public.account_invitations from public, anon, authenticated;

-- ===========================================================================
-- 5. Acceptance Verification
-- ===========================================================================
do $$
declare
  active_viewer_invites integer;
begin
  select count(*) into active_viewer_invites
    from public.account_invitations
   where role = 'viewer' and consumed_at is null and revoked_at is null;
  if active_viewer_invites > 0 then
    raise exception '070 acceptance failed: % unrevoked viewer invite(s) remain', active_viewer_invites;
  end if;
  raise notice '070 acceptance OK: role and invitation invariants enforced successfully.';
end;
$$;

commit;
