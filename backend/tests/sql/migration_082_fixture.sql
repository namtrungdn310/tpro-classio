-- Disposable-only owner fixture for M082/M083.  Production data must already
-- contain an explicitly mapped active admin; M082 intentionally aborts when it
-- cannot prove ownership instead of guessing.

insert into auth.users (id, email, raw_user_meta_data)
values (
  '00000000-0000-0000-0000-000000000082',
  'workspace-owner-082@invalid.example',
  '{"username":"workspace-owner-082"}'::jsonb
)
on conflict (id) do nothing;

insert into public.profiles (
  id, role, username, full_name, account_status
)
values (
  '00000000-0000-0000-0000-000000000082',
  'admin',
  'workspace-owner-082',
  'Workspace Owner 082',
  'active'
)
on conflict (id) do update
set role = excluded.role,
    account_status = excluded.account_status;
