-- Current-schema indexes for production-sized data.
-- Safe to run repeatedly.

create index if not exists idx_students_parent_zalo_lower_current
  on students ((lower(btrim(coalesce(parent_zalo, '')))))
  where parent_zalo is not null;

create index if not exists idx_students_student_phone_digits
  on students ((regexp_replace(coalesce(student_phone, ''), '\D', '', 'g')))
  where student_phone is not null;

create index if not exists idx_enrollments_status_enrollment_date
  on enrollments (status, enrollment_date);

create index if not exists idx_fee_records_period_status_paid_date
  on fee_records (period, status, paid_date);

create index if not exists idx_staff_members_type_active
  on staff_members (staff_type, is_active);
