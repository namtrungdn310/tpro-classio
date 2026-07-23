-- Exercise migration 028 against the schema and ledger shape that existed
-- before refunds were introduced. These rows intentionally use no 028 column.
insert into auth.users (id, email) values (
  '10000000-0000-0000-0000-000000000007',
  'ci-refund-actor@example.invalid'
);

insert into public.profiles (id, role, full_name) values (
  '10000000-0000-0000-0000-000000000007',
  'admin',
  'CI Refund Actor'
);

insert into public.classes (
  id, name, type, base_fee, billing_cycle_months, is_active
) values (
  '10000000-0000-0000-0000-000000000001',
  'CI Legacy Refund Upgrade',
  'MONTHLY',
  750000,
  1,
  true
);

insert into public.students (
  id, full_name, status
) values (
  '10000000-0000-0000-0000-000000000002',
  'CI Legacy Ledger Student',
  'active'
);

insert into public.enrollments (
  id, student_id, class_id, enrollment_date, status
) values (
  '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  current_date,
  'active'
);

insert into public.fee_records (
  id,
  enrollment_id,
  period,
  due_date,
  enrollment_date_snapshot,
  student_name_snapshot,
  class_name_snapshot,
  class_type_snapshot,
  billing_cycle_months_snapshot,
  base_amount,
  discount_amount,
  status,
  notified_at,
  notification_channel,
  notification_message,
  paid_amount,
  paid_date
) values (
  '10000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000003',
  to_char(current_date, 'YYYY-MM'),
  current_date,
  current_date,
  'CI Legacy Ledger Student',
  'CI Legacy Refund Upgrade',
  'MONTHLY',
  1,
  750000,
  0,
  'PAID',
  now(),
  'zalo_manual',
  'CI legacy payment notification',
  750000,
  current_date
);

insert into public.payments (
  id, fee_record_id, amount, payment_date, payment_method, note
) values
  (
    '10000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000004',
    750000,
    current_date,
    'bank_transfer',
    'CI legacy payment'
  ),
  (
    '10000000-0000-0000-0000-000000000006',
    '10000000-0000-0000-0000-000000000004',
    -750000,
    current_date,
    'bank_transfer',
    'Hoàn tác ghi nhận học phí CI legacy'
  );
