-- Business history is archived by the trusted backend. Authenticated browser
-- sessions must not be able to bypass that workflow through the Data API.
drop policy if exists "classes_delete" on public.classes;
drop policy if exists "students_delete" on public.students;
drop policy if exists "enrollments_delete" on public.enrollments;
drop policy if exists "fee_records_delete" on public.fee_records;
drop policy if exists "payments_delete" on public.payments;

revoke delete on table public.classes from anon, authenticated;
revoke delete on table public.students from anon, authenticated;
revoke delete on table public.enrollments from anon, authenticated;
revoke delete on table public.fee_records from anon, authenticated;
revoke delete on table public.payments from anon, authenticated;
