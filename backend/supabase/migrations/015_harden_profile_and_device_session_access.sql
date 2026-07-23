-- User device sessions contain authentication material and must never be exposed
-- through the Supabase Data API. The backend accesses this table through its
-- dedicated server-side database connection.
alter table user_device_sessions enable row level security;
alter table user_device_sessions force row level security;

revoke all privileges on table user_device_sessions from anon, authenticated;

-- A row policy limits which profile a user can update, but it does not limit
-- which columns can be changed. Restrict authenticated clients to non-security
-- profile fields so `role` can only be changed by the trusted backend.
drop policy if exists "profiles_update" on profiles;

create policy "profiles_update_own_public_fields"
on profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

revoke update on table profiles from anon, authenticated;
grant update (username, full_name) on table profiles to authenticated;
