-- 100 — document Dev workspace ownership for Pay2S staging tests.
--
-- `dev` is an effective application role derived from the immutable
-- OWNER_USER_ID. It is deliberately not a value of public.user_role, so a SQL
-- migration cannot safely discover or move the Dev profile. The original
-- owner workspace remains the Dev staging workspace; each subsequently invited
-- Admin receives a reserved workspace through migrations 084/099.

begin;

do $$
begin
  if exists (
    select 1
      from public.workspaces
     where owner_user_id is not null
     group by owner_user_id
    having count(*) > 1
  ) then
    raise exception 'a user must not own more than one workspace';
  end if;
end;
$$;

insert into ops.platform_actions (
  action, reason, result, metadata
) values (
  'ISOLATE_DEV_WORKSPACES',
  'Confirmed workspace-owned Pay2S; Dev identity remains application-derived.',
  'APPLIED',
  jsonb_build_object('pay2s_ownership', 'one_account_per_workspace')
);

commit;
