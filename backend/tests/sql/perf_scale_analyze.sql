-- PERF SCALE ANALYZE — refresh planner statistics after seeding the scale
-- dataset so EXPLAIN reflects a realistic plan (not an empty-table heuristic).

analyze public.staff_members;
analyze public.classes;
analyze public.class_teachers;
analyze public.class_schedule_slots;
analyze public.class_schedule_slot_staff;
analyze public.class_lifecycle_events;
analyze public.students;
analyze public.enrollments;
analyze public.fee_records;
analyze public.payments;
analyze public.class_session_exceptions;
