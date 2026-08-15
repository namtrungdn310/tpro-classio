-- R6-D08 — Student profile lifecycle expand (forward-only).
--
-- Contract: dev.md §6.1/§6.4, test.md §6. Archive is explicit with
-- actor/reason; no cascade can destroy finance/history; student_code stays
-- immutable; derived list states UNASSIGNED/CURRENT/FORMER.
--
-- Part 1 (this file): enum value add ONLY (PostgreSQL unsafe-enum rule).
-- Part 2 (next migration): FK RESTRICT + archive columns + indexes.

begin;

do $$
begin
  if not exists (
    select 1 from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'student_status' and e.enumlabel = 'archived'
  ) then
    alter type public.student_status add value 'archived';
  end if;
end;
$$;

commit;
