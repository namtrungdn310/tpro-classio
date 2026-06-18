-- TPRO Classio Phase 1 initial schema
-- Run this file in the Supabase SQL Editor.

create extension if not exists pgcrypto;

-- 1. ENUMS
create type class_type as enum ('MONTHLY', 'COURSE');
create type fee_status as enum ('UNPAID', 'PAID');
create type user_role as enum ('admin', 'viewer');
create type student_status as enum ('active', 'inactive');
create type enrollment_status as enum ('active', 'dropped');
create type payment_method as enum ('bank_transfer', 'cash');

-- 2. TABLES
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'viewer',
  full_name text,
  created_at timestamptz not null default now()
);

create table students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  birth_year smallint,
  school text,
  parent_name text,
  parent_phone text,
  parent_zalo_name text,
  notes text,
  status student_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type class_type not null,
  base_fee numeric(12,0) not null default 0,
  start_date date,
  end_date date,
  schedule jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  enrollment_date date,
  custom_fee numeric(12,0),
  status enrollment_status not null default 'active',
  created_at timestamptz not null default now(),
  unique(student_id, class_id)
);

create table fee_records (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  period text not null,
  base_amount numeric(12,0) not null,
  discount_amount numeric(12,0) not null default 0,
  discount_reason text,
  final_amount numeric(12,0) generated always as (base_amount - discount_amount) stored,
  status fee_status not null default 'UNPAID',
  paid_amount numeric(12,0),
  paid_date date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  fee_record_id uuid not null references fee_records(id) on delete cascade,
  amount numeric(12,0) not null,
  payment_date date not null default current_date,
  payment_method payment_method default 'bank_transfer',
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- 3. INDEXES
create index idx_students_status on students(status);
create index idx_enrollments_student on enrollments(student_id);
create index idx_enrollments_class on enrollments(class_id);
create index idx_fee_records_enrollment on fee_records(enrollment_id);
create index idx_fee_records_status on fee_records(status);
create index idx_fee_records_period on fee_records(period);

-- 4. UPDATED_AT TRIGGER
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger students_updated_at
before update on students
for each row execute function set_updated_at();

create trigger fee_records_updated_at
before update on fee_records
for each row execute function set_updated_at();

-- 5. ROW LEVEL SECURITY
alter table profiles enable row level security;
alter table students enable row level security;
alter table classes enable row level security;
alter table enrollments enable row level security;
alter table fee_records enable row level security;
alter table payments enable row level security;

create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1
    from profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$ language sql security definer;

create policy "profiles_select"
on profiles for select
using (id = auth.uid());

create policy "profiles_update"
on profiles for update
using (id = auth.uid());

do $$
declare
  t text;
begin
  for t in select unnest(array['students','classes','enrollments','fee_records','payments'])
  loop
    execute format('create policy "%s_select" on %I for select using (auth.uid() is not null)', t, t);
    execute format('create policy "%s_insert" on %I for insert with check (is_admin())', t, t);
    execute format('create policy "%s_update" on %I for update using (is_admin())', t, t);
    execute format('create policy "%s_delete" on %I for delete using (is_admin())', t, t);
  end loop;
end $$;

-- 6. SEED DATA
insert into classes (name, type, base_fee) values
  ('IELTS 6.0', 'MONTHLY', 1400000),
  ('Lớp 9 HSG', 'MONTHLY', 900000),
  ('Thi ĐH', 'MONTHLY', 800000);

-- After creating users in Supabase Auth dashboard, insert their profiles:
-- insert into profiles (id, role, full_name) values
--   ('<admin-uuid>', 'admin', 'Admin'),
--   ('<viewer-uuid>', 'viewer', 'Giáo viên');

insert into students (
  full_name,
  birth_year,
  school,
  parent_name,
  parent_phone,
  parent_zalo_name
) values
  ('Nguyễn Minh Tuấn', 2009, 'THPT Lê Quý Đôn', 'Nguyễn Văn Bình', '0905123456', 'Bình Tuấn PH'),
  ('Trần Thị Lan', 2010, 'THCS Nguyễn Huệ', 'Trần Thị Mai', '0912345678', 'Mai Lan mama'),
  ('Lê Quang Huy', 2011, 'THCS Tây Sơn', 'Lê Văn Hùng', '0934567890', 'Hùng bố Huy');
