-- R6-D13 — Add `teacher` to user_role enum (own transaction; PG enum rule).
-- The persistent enum stays grantable-only admin|teacher (viewer history kept
-- for audit); effective `dev` is owner-derived and never stored here.

begin;

do $$
begin
  if not exists (
    select 1 from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role' and e.enumlabel = 'teacher'
  ) then
    alter type public.user_role add value 'teacher';
  end if;
end;
$$;

commit;
