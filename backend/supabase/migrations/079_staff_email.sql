-- R8-D12 — Add optional contact email to staff_members (forward-only).
--
-- Admin may record a staff email when creating the staff profile.  This email
-- is later used by the dev invite flow to prefill the invited account's email
-- when linking the staff to a login account (teacher attendance).  It is
-- contact metadata only — never used as a secret, auth proof or idempotency
-- key, and it must not be exposed to non-management roles.
--
-- The column is nullable and unvalidated (unlike phone) because legacy staff
-- rows have no email; the application layer normalizes/validates it on write.
-- A CHECK keeps it a well-formed-ish non-whitespace string to avoid accidental
-- blanks; exact email validation stays in the Pydantic layer.

begin;

alter table public.staff_members
  add column if not exists email text;

alter table public.staff_members
  add constraint staff_members_email_blank_check
  check (email is null or btrim(email) <> '');

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'staff_members'
       and column_name = 'email'
  ) then
    raise exception '079 acceptance failed: staff_members.email is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.staff_members'::regclass
       and conname = 'staff_members_email_blank_check'
  ) then
    raise exception '079 acceptance failed: staff_members_email_blank_check is missing';
  end if;
  raise notice '079 acceptance OK: staff_members.email installed';
end;
$$;

commit;
