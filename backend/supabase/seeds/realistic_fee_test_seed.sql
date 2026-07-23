-- DEVELOPMENT ONLY: realistic test data for fee collection flows.
-- Never run this file on staging or production. It deletes and rebuilds all
-- business data while intentionally retaining auth.users and profiles.

begin;

alter table fee_records
  add column if not exists notified_at timestamptz,
  add column if not exists notification_channel text,
  add column if not exists notification_message text;

do $$
begin
  if to_regclass('public.class_teachers') is not null then
    execute 'delete from public.class_teachers';
  end if;
end $$;
delete from payments;
delete from fee_records;
delete from enrollments;
delete from students;
delete from classes;

insert into classes (
  name,
  type,
  base_fee,
  billing_cycle_months,
  start_date,
  schedule,
  is_active
) values
  (
    '6C1',
    'MONTHLY'::class_type,
    750000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 2 (13:30-15:00); Thứ 4 (13:30-15:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 2', 'start', '13:30', 'end', '15:00'),
        jsonb_build_object('day', 'Thứ 4', 'start', '13:30', 'end', '15:00')
      )
    ),
    true
  ),
  (
    '6C2',
    'MONTHLY'::class_type,
    750000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 3 (13:30-15:00); Thứ 5 (13:30-15:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 3', 'start', '13:30', 'end', '15:00'),
        jsonb_build_object('day', 'Thứ 5', 'start', '13:30', 'end', '15:00')
      )
    ),
    true
  ),
  (
    '6C3',
    'MONTHLY'::class_type,
    750000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 3 (15:00-16:30); Thứ 5 (15:00-16:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 3', 'start', '15:00', 'end', '16:30'),
        jsonb_build_object('day', 'Thứ 5', 'start', '15:00', 'end', '16:30')
      )
    ),
    true
  ),
  (
    '7C1',
    'MONTHLY'::class_type,
    800000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 2 (17:00-18:30); Thứ 4 (17:00-18:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 2', 'start', '17:00', 'end', '18:30'),
        jsonb_build_object('day', 'Thứ 4', 'start', '17:00', 'end', '18:30')
      )
    ),
    true
  ),
  (
    '7C2',
    'MONTHLY'::class_type,
    800000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 3 (17:00-18:30); Thứ 5 (17:00-18:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 3', 'start', '17:00', 'end', '18:30'),
        jsonb_build_object('day', 'Thứ 5', 'start', '17:00', 'end', '18:30')
      )
    ),
    true
  ),
  (
    '7C3',
    'MONTHLY'::class_type,
    800000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 4 (15:30-17:00); Thứ 6 (15:30-17:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 4', 'start', '15:30', 'end', '17:00'),
        jsonb_build_object('day', 'Thứ 6', 'start', '15:30', 'end', '17:00')
      )
    ),
    true
  ),
  (
    '7C4',
    'MONTHLY'::class_type,
    800000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 2 (15:30-17:00); Thứ 7 (10:00-11:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 2', 'start', '15:30', 'end', '17:00'),
        jsonb_build_object('day', 'Thứ 7', 'start', '10:00', 'end', '11:30')
      )
    ),
    true
  ),
  (
    'Kèm 9',
    'MONTHLY'::class_type,
    1200000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 3 (20:00-21:30); Thứ 6 (20:00-21:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 3', 'start', '20:00', 'end', '21:30'),
        jsonb_build_object('day', 'Thứ 6', 'start', '20:00', 'end', '21:30')
      )
    ),
    true
  ),
  (
    'L12',
    'MONTHLY'::class_type,
    1000000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 2 (20:00-21:30); Thứ 4 (20:00-21:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 2', 'start', '20:00', 'end', '21:30'),
        jsonb_build_object('day', 'Thứ 4', 'start', '20:00', 'end', '21:30')
      )
    ),
    true
  ),
  (
    'IELTS 10',
    'COURSE'::class_type,
    4500000,
    3,
    current_date - interval '4 months',
    jsonb_build_object(
      'text', 'Thứ 4 (18:30-20:00); Thứ 6 (18:30-20:00); Thứ 7 (08:00-10:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 4', 'start', '18:30', 'end', '20:00'),
        jsonb_build_object('day', 'Thứ 6', 'start', '18:30', 'end', '20:00'),
        jsonb_build_object('day', 'Thứ 7', 'start', '08:00', 'end', '10:00')
      )
    ),
    true
  ),
  (
    'IELTS Tổng hợp',
    'COURSE'::class_type,
    8000000,
    6,
    current_date - interval '7 months',
    jsonb_build_object(
      'text', 'Thứ 3 (18:30-20:00); Thứ 5 (18:30-20:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 3', 'start', '18:30', 'end', '20:00'),
        jsonb_build_object('day', 'Thứ 5', 'start', '18:30', 'end', '20:00')
      )
    ),
    true
  ),
  (
    'IELTS Chuyên sâu',
    'COURSE'::class_type,
    13500000,
    12,
    current_date - interval '12 months',
    jsonb_build_object(
      'text', 'Thứ 2 (18:30-20:00); Thứ 5 (18:30-20:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 2', 'start', '18:30', 'end', '20:00'),
        jsonb_build_object('day', 'Thứ 5', 'start', '18:30', 'end', '20:00')
      )
    ),
    true
  );

create temporary table seed_students (
  full_name text primary key,
  birth_year smallint,
  school text,
  parent_name text,
  parent_phone text,
  parent_zalo_name text
) on commit drop;

insert into seed_students values
  ('Nguyễn An Khang', 2014, 'THCS Chu Văn An', 'Nguyễn Hoàng Bình', '0901122334', 'Mẹ Khang Bảo'),
  ('Lê Gia Bảo', 2014, 'THCS Chu Văn An', 'Nguyễn Hoàng Bình', '0901122334', 'Mẹ Khang Bảo'),
  ('Phạm Minh Khoa', 2014, 'THCS Lý Thường Kiệt', 'Phạm Thanh Sơn', '0912233445', 'Ba Khoa'),
  ('Võ Hà My', 2014, 'THCS Nguyễn Du', 'Võ Thanh Hà', '0934455667', 'Hà My Mẹ'),
  ('Trần Nhật Minh', 2014, 'THCS Tây Sơn', 'Trần Quốc Huy', '0987654321', 'Ba Nhật Minh'),
  ('Đỗ Quang Huy', 2014, 'THCS Tây Sơn', 'Đỗ Minh Tâm', '0971122334', 'Mẹ Quang Huy'),
  ('Huỳnh Bảo Ngọc', 2014, 'THCS Nguyễn Huệ', 'Huỳnh Anh Tuấn', '0962233445', 'Ngọc Huỳnh PH'),
  ('Mai Anh Thư', 2014, 'THCS Nguyễn Huệ', 'Mai Thu Hà', '0356677889', 'Mẹ Anh Thư'),
  ('Phan Đức Anh', 2014, 'THCS Nguyễn Trãi', 'Phan Đức Long', '0381122446', 'Ba Đức Anh'),
  ('Bùi Khánh Linh', 2013, 'THCS Nguyễn Trãi', 'Bùi Minh Châu', '0392233557', 'Linh Châu'),
  ('Trương Minh Đức', 2013, 'THCS Lê Lợi', 'Trương Văn Nam', '0701122334', 'Ba Minh Đức'),
  ('Nguyễn Hoàng Phúc', 2013, 'THCS Lê Lợi', 'Nguyễn Thanh Phong', '0772233445', 'Phong PH'),
  ('Trần Bảo Hân', 2013, 'THCS Marie Curie', 'Trần Thị Hạnh', '0783344556', 'Mẹ Bảo Hân'),
  ('Lê Nhật Vy', 2013, 'THCS Marie Curie', 'Lê Quốc Việt', '0794455667', 'Nhật Vy PH'),
  ('Phạm Gia Huy', 2013, 'THCS Nguyễn Du', 'Phạm Anh Khoa', '0831122334', 'Ba Gia Huy'),
  ('Võ Minh Quân', 2013, 'THCS Tây Sơn', 'Võ Hoàng Dũng', '0842233445', 'Quân Dũng'),
  ('Nguyễn Thanh Trúc', 2013, 'THCS Tây Sơn', 'Nguyễn Thị Lan', '0853344556', 'Mẹ Thanh Trúc'),
  ('Hồ Khánh An', 2013, 'THCS Lý Thường Kiệt', 'Hồ Minh Quang', '0864455667', 'Khánh An PH'),
  ('Lê Anh Khoa', 2012, 'THCS Nguyễn Huệ', 'Lê Đức Tài', '0871122334', 'Ba Anh Khoa'),
  ('Nguyễn Phương Mai', 2012, 'THCS Nguyễn Huệ', 'Nguyễn Thu Hương', '0882233445', 'Mai Hương'),
  ('Phan Minh Châu', 2012, 'THCS Chu Văn An', 'Phan Quốc Hưng', '0893344556', 'Ba Minh Châu'),
  ('Huỳnh Tấn Phát', 2012, 'THCS Chu Văn An', 'Huỳnh Văn Lộc', '0321122334', 'Phát Lộc'),
  ('Võ Quốc Hưng', 2011, 'THCS Tây Sơn', 'Võ Thị Mai', '0332233445', 'Mẹ Quốc Hưng'),
  ('Trịnh Hà Anh', 2011, 'THCS Lê Lợi', 'Trịnh Minh Tuấn', '0343344556', 'Hà Anh PH'),
  ('Trần Đức Thịnh', 2008, 'THPT Lê Quý Đôn', 'Trần Đức Hoà', '0361122334', 'Ba Đức Thịnh'),
  ('Phạm Ngọc Ánh', 2008, 'THPT Nguyễn Trãi', 'Phạm Thị Ngọc', '0372233445', 'Mẹ Ngọc Ánh'),
  ('Nguyễn Minh Tuấn', 2009, 'THPT Lê Quý Đôn', 'Nguyễn Văn Bình', '0905123456', 'Bình Tuấn PH'),
  ('Trần Thị Lan', 2010, 'THCS Nguyễn Huệ', 'Trần Thị Mai', '0912345678', 'Mai Lan mama'),
  ('Lê Quang Huy', 2011, 'THCS Tây Sơn', 'Lê Văn Hùng', '0934567890', 'Hùng bố Huy'),
  ('Hoàng Bảo Trâm', 2009, 'THPT Gia Định', 'Hoàng Thanh Phúc', '0945678901', 'Trâm Hoàng PH'),
  ('Đinh Gia Hân', 2010, 'THPT Trần Phú', 'Đinh Minh Hải', '0956789012', 'Gia Hân PH'),
  ('Vũ Thanh Long', 2010, 'THPT Trần Phú', 'Vũ Anh Duy', '0967890123', 'Long Duy'),
  ('Nguyễn Bảo Vy', 2010, 'THPT Nguyễn Thị Minh Khai', 'Nguyễn Bảo Quốc', '0978901234', 'Bảo Vy PH'),
  ('Phạm Hoàng Nam', 2008, 'Đại học năm 1', 'Phạm Quốc Cường', '0989012345', 'Hoàng Nam PH'),
  ('Lê Mai Chi', 2008, 'Đại học năm 1', 'Lê Thị Thu', '0990123456', 'Mai Chi PH');

insert into students (
  full_name,
  birth_date,
  school,
  parent_name,
  parent_phone,
  parent_zalo,
  status
)
select
  full_name,
  make_date(birth_year, 1, 1),
  school,
  parent_name,
  parent_phone,
  parent_zalo_name,
  'active'::student_status
from seed_students;

create temporary table seed_enrollments (
  full_name text,
  class_name text,
  enrollment_date date,
  custom_fee numeric(12, 0),
  fee_state text
) on commit drop;

with d as (
  select date_trunc('month', current_date)::date as month_start
),
raw_seed (
  full_name,
  class_name,
  cycle_kind,
  due_day,
  custom_fee,
  fee_state
) as (
  values
    ('Nguyễn An Khang', '6C1', 'monthly_due', 3, null::numeric, 'UNNOTIFIED'),
    ('Lê Gia Bảo', '6C1', 'monthly_due', 5, null::numeric, 'NOTIFIED_UNPAID'),
    ('Phạm Minh Khoa', '6C1', 'monthly_due', 7, 700000::numeric, 'PAID'),
    ('Võ Hà My', '6C1', 'monthly_not_due', 20, null::numeric, 'NOT_DUE'),
    ('Trần Nhật Minh', '6C2', 'monthly_due', 4, null::numeric, 'PAID'),
    ('Đỗ Quang Huy', '6C2', 'monthly_due', 8, null::numeric, 'UNNOTIFIED'),
    ('Huỳnh Bảo Ngọc', '6C2', 'monthly_due', 10, 720000::numeric, 'NOTIFIED_UNPAID'),
    ('Mai Anh Thư', '6C2', 'monthly_due', 16, null::numeric, 'PAID'),
    ('Phan Đức Anh', '6C3', 'monthly_due', 6, null::numeric, 'NOTIFIED_UNPAID'),
    ('Bùi Khánh Linh', '6C3', 'monthly_due', 9, null::numeric, 'PAID'),
    ('Trương Minh Đức', '6C3', 'monthly_due', 13, 730000::numeric, 'UNNOTIFIED'),
    ('Nguyễn Hoàng Phúc', '7C1', 'monthly_due', 2, null::numeric, 'PAID'),
    ('Trần Bảo Hân', '7C1', 'monthly_due', 11, null::numeric, 'NOTIFIED_UNPAID'),
    ('Lê Nhật Vy', '7C1', 'monthly_due', 18, 760000::numeric, 'UNNOTIFIED'),
    ('Phạm Gia Huy', '7C2', 'monthly_due', 5, null::numeric, 'PAID'),
    ('Võ Minh Quân', '7C2', 'monthly_due', 12, null::numeric, 'NOTIFIED_UNPAID'),
    ('Nguyễn Thanh Trúc', '7C2', 'monthly_due', 19, 850000::numeric, 'UNNOTIFIED'),
    ('Hồ Khánh An', '7C2', 'monthly_not_due', 22, null::numeric, 'NOT_DUE'),
    ('Lê Anh Khoa', '7C3', 'monthly_due', 4, null::numeric, 'NOTIFIED_UNPAID'),
    ('Nguyễn Phương Mai', '7C3', 'monthly_due', 14, null::numeric, 'PAID'),
    ('Phan Minh Châu', '7C4', 'monthly_due', 6, null::numeric, 'UNNOTIFIED'),
    ('Huỳnh Tấn Phát', '7C4', 'monthly_due', 15, null::numeric, 'PAID'),
    ('Võ Quốc Hưng', 'Kèm 9', 'monthly_due', 1, 1100000::numeric, 'NOTIFIED_UNPAID'),
    ('Trịnh Hà Anh', 'Kèm 9', 'monthly_due', 17, null::numeric, 'PAID'),
    ('Trần Đức Thịnh', 'L12', 'monthly_due', 5, null::numeric, 'UNNOTIFIED'),
    ('Phạm Ngọc Ánh', 'L12', 'monthly_due', 20, null::numeric, 'NOTIFIED_UNPAID'),
    ('Nguyễn Minh Tuấn', 'IELTS 10', 'course12_due', 1, null::numeric, 'PAID'),
    ('Trần Thị Lan', 'IELTS 10', 'course12_due', 9, 4200000::numeric, 'UNNOTIFIED'),
    ('Lê Quang Huy', 'IELTS 10', 'course12_due', 15, null::numeric, 'NOTIFIED_UNPAID'),
    ('Hoàng Bảo Trâm', 'IELTS 10', 'course12_due', 24, null::numeric, 'PAID'),
    ('Đinh Gia Hân', 'IELTS Tổng hợp', 'course24_due', 2, null::numeric, 'NOTIFIED_UNPAID'),
    ('Vũ Thanh Long', 'IELTS Tổng hợp', 'course24_due', 18, 7600000::numeric, 'PAID'),
    ('Nguyễn Bảo Vy', 'IELTS Tổng hợp', 'course24_due', 25, null::numeric, 'UNNOTIFIED'),
    ('Phạm Hoàng Nam', 'IELTS Chuyên sâu', 'course48_due', 6, null::numeric, 'PAID'),
    ('Lê Mai Chi', 'IELTS Chuyên sâu', 'course48_due', 23, 12800000::numeric, 'NOTIFIED_UNPAID'),
    ('Nguyễn Minh Tuấn', 'L12', 'monthly_due', 12, 950000::numeric, 'NOTIFIED_UNPAID'),
    ('Trần Thị Lan', '7C2', 'monthly_due', 9, null::numeric, 'PAID'),
    ('Lê Quang Huy', 'Kèm 9', 'monthly_not_due', 21, null::numeric, 'NOT_DUE')
)
insert into seed_enrollments (
  full_name,
  class_name,
  enrollment_date,
  custom_fee,
  fee_state
)
select
  raw_seed.full_name,
  raw_seed.class_name,
  case raw_seed.cycle_kind
    when 'monthly_due' then
      (d.month_start - interval '1 month' + (raw_seed.due_day - 1) * interval '1 day')::date
    when 'monthly_not_due' then
      (d.month_start + (raw_seed.due_day - 1) * interval '1 day')::date
    when 'course12_due' then
      (d.month_start + (raw_seed.due_day - 1) * interval '1 day' - interval '84 days')::date
    when 'course24_due' then
      (d.month_start + (raw_seed.due_day - 1) * interval '1 day' - interval '168 days')::date
    when 'course48_due' then
      (d.month_start + (raw_seed.due_day - 1) * interval '1 day' - interval '336 days')::date
  end,
  raw_seed.custom_fee,
  raw_seed.fee_state
from raw_seed
cross join d;

insert into enrollments (
  student_id,
  class_id,
  enrollment_date,
  custom_fee,
  status
)
select
  students.id,
  classes.id,
  seed_enrollments.enrollment_date,
  seed_enrollments.custom_fee,
  'active'::enrollment_status
from seed_enrollments
join students on students.full_name = seed_enrollments.full_name
join classes on classes.name = seed_enrollments.class_name;

create or replace function get_due_date(
  p_enrollment_date date,
  p_class_type class_type,
  p_billing_cycle_months smallint
)
returns date
language sql
immutable
as $$
  select case
    when p_class_type = 'MONTHLY'::class_type then
      (p_enrollment_date + interval '1 month')::date
    when p_billing_cycle_months = 2 then
      (p_enrollment_date + interval '56 days')::date
    when p_billing_cycle_months = 3 then
      (p_enrollment_date + interval '84 days')::date
    when p_billing_cycle_months = 6 then
      (p_enrollment_date + interval '168 days')::date
    when p_billing_cycle_months = 12 then
      (p_enrollment_date + interval '336 days')::date
    else
      (p_enrollment_date + make_interval(months => p_billing_cycle_months::int))::date
  end
$$;

insert into fee_records (
  enrollment_id,
  period,
  base_amount,
  discount_amount,
  status,
  notified_at,
  notification_channel,
  notification_message,
  paid_amount,
  paid_date,
  note
)
select
  enrollments.id,
  to_char(current_date, 'YYYY-MM'),
  coalesce(seed_enrollments.custom_fee, classes.base_fee),
  0,
  case
    when seed_enrollments.fee_state = 'PAID' then 'PAID'::fee_status
    else 'UNPAID'::fee_status
  end,
  case
    when seed_enrollments.fee_state in ('NOTIFIED_UNPAID', 'PAID')
      then (date_trunc('month', current_date)::date + (least(extract(day from get_due_date(seed_enrollments.enrollment_date, classes.type, classes.billing_cycle_months)), extract(day from (date_trunc('month', current_date) + interval '1 month' - interval '1 day')))::int - 1) * interval '1 day') - interval '2 days'
    else null
  end,
  case
    when seed_enrollments.fee_state in ('NOTIFIED_UNPAID', 'PAID') then 'zalo_copy'
    else null
  end,
  case
    when seed_enrollments.fee_state in ('NOTIFIED_UNPAID', 'PAID') then
      'TPRO English thông báo học phí của em '
      || students.full_name
      || ' - '
      || classes.name
      || ' đến hạn ngày '
      || to_char((date_trunc('month', current_date)::date + (least(extract(day from get_due_date(seed_enrollments.enrollment_date, classes.type, classes.billing_cycle_months)), extract(day from (date_trunc('month', current_date) + interval '1 month' - interval '1 day')))::int - 1) * interval '1 day'), 'DD/MM/YYYY')
      || '. Số tiền: '
      || replace(to_char(coalesce(seed_enrollments.custom_fee, classes.base_fee), 'FM999G999G999G999'), ',', '.')
      || 'đ. Phụ huynh vui lòng thanh toán giúp trung tâm. Cảm ơn phụ huynh.'
    else null
  end,
  case
    when seed_enrollments.fee_state = 'PAID' then coalesce(seed_enrollments.custom_fee, classes.base_fee)
    else null
  end,
  case
    when seed_enrollments.fee_state = 'PAID'
      then (date_trunc('month', current_date)::date + (least(extract(day from get_due_date(seed_enrollments.enrollment_date, classes.type, classes.billing_cycle_months)), extract(day from (date_trunc('month', current_date) + interval '1 month' - interval '1 day')))::int - 1) * interval '1 day') + interval '2 days'
    else null
  end,
  case
    when seed_enrollments.custom_fee is not null then 'Seed: học phí riêng'
    else 'Seed: học phí mặc định'
  end
from seed_enrollments
join students on students.full_name = seed_enrollments.full_name
join classes on classes.name = seed_enrollments.class_name
join enrollments on enrollments.student_id = students.id and enrollments.class_id = classes.id
where seed_enrollments.fee_state <> 'NOT_DUE';

insert into payments (
  fee_record_id,
  amount,
  payment_date,
  payment_method,
  note
)
select
  fee_records.id,
  fee_records.paid_amount,
  fee_records.paid_date,
  case
    when row_number() over (order by fee_records.paid_date, fee_records.id) % 3 = 0
      then 'cash'::payment_method
    else 'bank_transfer'::payment_method
  end,
  'Seed: thanh toán học phí test'
from fee_records
where fee_records.status = 'PAID';

commit;

drop function if exists get_due_date(date, class_type, smallint);
