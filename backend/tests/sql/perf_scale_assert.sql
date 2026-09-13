-- PERF SCALE ASSERT — verify the benchmark dataset reached its mandated scale.
-- Fails the disposable pipeline with ON_ERROR_STOP if any count is short.

do $$
declare
  v_classes bigint;
  v_canonical_classes bigint;
  v_legacy_classes bigint;
  v_students bigint;
  v_fee_records bigint;
  v_enrollments bigint;
  v_staff bigint;
  v_teachers bigint;
  v_slots bigint;
  v_paid bigint;
  v_superseded bigint;
  v_void bigint;
  v_unpaid bigint;
  v_notified bigint;
begin
  -- Isolate the scale dataset by the perf naming convention so pre-existing
  -- migration fixtures (a handful of classes/students) never skew the counts.
  select count(*) into v_classes from public.classes where name like 'PerfLop %';
  select count(*) into v_canonical_classes from public.classes where name like 'PerfLop %' and identity_scheme <> 'LEGACY';
  select count(*) into v_legacy_classes from public.classes where name like 'PerfLop %' and identity_scheme = 'LEGACY';
  select count(*) into v_students from public.students where full_name like 'PerfHV %';
  select count(*) into v_fee_records
    from public.fee_records fr
    join public.enrollments e on e.id = fr.enrollment_id
    join public.students s on s.id = e.student_id
   where s.full_name like 'PerfHV %';
  select count(*) into v_enrollments
    from public.enrollments e
    join public.students s on s.id = e.student_id
   where s.full_name like 'PerfHV %';
  select count(*) into v_staff from public.staff_members where full_name like 'PerfGV %';
  select count(*) into v_teachers from public.staff_members where full_name like 'PerfGV %' and staff_type = 'TEACHER';
  select count(*) into v_slots
    from public.class_schedule_slots sl
    join public.classes c on c.id = sl.class_id
   where c.name like 'PerfLop %';
  select count(*) into v_paid
    from public.fee_records fr
    join public.enrollments e on e.id = fr.enrollment_id
    join public.students s on s.id = e.student_id
   where s.full_name like 'PerfHV %' and fr.status = 'PAID';
  select count(*) into v_superseded
    from public.fee_records fr
    join public.enrollments e on e.id = fr.enrollment_id
    join public.students s on s.id = e.student_id
   where s.full_name like 'PerfHV %' and fr.status = 'SUPERSEDED';
  select count(*) into v_void
    from public.fee_records fr
    join public.enrollments e on e.id = fr.enrollment_id
    join public.students s on s.id = e.student_id
   where s.full_name like 'PerfHV %' and fr.status = 'VOID';
  select count(*) into v_unpaid
    from public.fee_records fr
    join public.enrollments e on e.id = fr.enrollment_id
    join public.students s on s.id = e.student_id
   where s.full_name like 'PerfHV %' and fr.status = 'UNPAID';
  select count(*) into v_notified
    from public.fee_records fr
    join public.enrollments e on e.id = fr.enrollment_id
    join public.students s on s.id = e.student_id
   where s.full_name like 'PerfHV %' and fr.notified_at is not null;

  if v_classes <> 1000 then
    raise exception 'PerfScale assert: classes=% (expected 1000)', v_classes;
  end if;
  if v_students <> 5000 then
    raise exception 'PerfScale assert: students=% (expected 5000)', v_students;
  end if;
  if v_fee_records < 50000 then
    raise exception 'PerfScale assert: fee_records=% (expected >= 50000)', v_fee_records;
  end if;
  if v_staff < 200 then
    raise exception 'PerfScale assert: staff=% (expected >= 200)', v_staff;
  end if;
  if v_teachers < 150 then
    raise exception 'PerfScale assert: teachers=% (expected >= 150)', v_teachers;
  end if;
  -- At least 70% of classes must be canonical so the 078 scope index applies.
  -- (Completed/cancelled classes are LEGACY in this fixture because the 044
  -- lifecycle trigger forbids inserting backdated non-LEGACY classes.)
  if v_canonical_classes < 700 then
    raise exception 'PerfScale assert: canonical classes=% (expected >= 700)', v_canonical_classes;
  end if;
  -- A meaningful LEGACY slice must remain to prove the partial index skips it.
  if v_legacy_classes < 100 then
    raise exception 'PerfScale assert: legacy classes=% (expected >= 100)', v_legacy_classes;
  end if;
  -- The 078 fee index must have real UNPAID rows to exercise the projection.
  if v_unpaid < 20000 then
    raise exception 'PerfScale assert: unpaid fee_records=% (expected >= 20000)', v_unpaid;
  end if;
  if v_paid < 5000 then
    raise exception 'PerfScale assert: paid fee_records=% (expected >= 5000)', v_paid;
  end if;

  raise notice 'PerfScale assert OK: classes=% canonical=% legacy=% students=% fee=% (unpaid=% paid=% void=% superseded=% notified=%) staff=% teachers=% enrollments=% slots=%',
    v_classes, v_canonical_classes, v_legacy_classes, v_students, v_fee_records,
    v_unpaid, v_paid, v_void, v_superseded, v_notified, v_staff, v_teachers,
    v_enrollments, v_slots;
end;
$$;
