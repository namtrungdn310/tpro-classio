-- TPRO Classio performance indexes
-- Apply after 001_initial_schema.sql

create index if not exists idx_students_created_at_desc
  on students (created_at desc);

create index if not exists idx_classes_active_created_at_desc
  on classes (is_active, created_at desc);

create index if not exists idx_enrollments_class_status
  on enrollments (class_id, status);

create index if not exists idx_enrollments_student_status
  on enrollments (student_id, status);

create index if not exists idx_fee_records_period_enrollment
  on fee_records (period, enrollment_id);

create index if not exists idx_students_parent_phone_digits
  on students ((regexp_replace(coalesce(parent_phone, ''), '\D', '', 'g')))
  where parent_phone is not null;

create index if not exists idx_students_parent_zalo_lower
  on students ((lower(btrim(coalesce(parent_zalo_name, '')))))
  where parent_zalo_name is not null;
