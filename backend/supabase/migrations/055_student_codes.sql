-- R6-D04 — Student codes: expand + backfill + switch (forward-only).
--
-- Contract: dev.md §6.4, test.md §6.5. The database is the sole issuer of
-- `students.student_code` (format TP + 8 serial digits + Luhn check digit)
-- via a NO CYCLE sequence; the registry is append-only and prevents reuse.
-- `student_code` stays NULLABLE until parity proof (contract step in D08).

begin;

-- ===========================================================================
-- 1. Preflight (no mutation yet)
-- ===========================================================================
do $$
declare
  total_students bigint;
  coded_students bigint;
  backfill_count bigint;
  registry_count bigint;
  has_column boolean;
begin
  if to_regclass('public.student_code_registry') is not null then
    raise notice 'M055 rerun: registry already exists';
  end if;

  select count(*) into total_students from public.students;
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'students'
       and column_name = 'student_code'
  ) into has_column;
  if has_column then
    select count(*) into coded_students from public.students where student_code is not null;
  else
    coded_students := 0;
  end if;
  if to_regclass('public._migration_055_student_code_backfill') is not null then
    select count(*) into backfill_count
      from public._migration_055_student_code_backfill
     where run_id = 'M055-R6';
  else
    backfill_count := 0;
  end if;
  if to_regclass('public.student_code_registry') is not null then
    select count(*) into registry_count from public.student_code_registry;
  else
    registry_count := 0;
  end if;

  if coded_students = 0 then
    raise notice 'M055 preflight OK: fresh backfill path (students=%)', total_students;
  elsif coded_students = total_students
        and backfill_count = total_students
        and registry_count >= total_students then
    raise notice 'M055 rerun: already backfilled (students=%), no-op path', total_students;
  else
    raise exception 'M055 preflight abort: partial/ambiguous backfill state (coded=%, total=%, evidence=%, registry=%)',
      coded_students, total_students, backfill_count, registry_count;
  end if;
end;
$$;

-- ===========================================================================
-- 2. Sequence + SQL functions (fixed search_path, minimal EXECUTE)
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_sequences where schemaname = 'public' and sequencename = 'student_code_serial_seq') then
    create sequence public.student_code_serial_seq
      as bigint
      minvalue 1
      maxvalue 99999999
      start with 1
      no cycle;
  end if;
end;
$$;

create or replace function public.student_code_luhn_check(serial_digits text)
returns integer
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  total integer := 0;
  idx integer := 0;
  d integer;
  ch text;
begin
  if serial_digits is null or length(serial_digits) <> 8 then
    raise exception 'serial_digits must contain exactly 8 digits';
  end if;
  for i in reverse length(serial_digits)..1 loop
    ch := substr(serial_digits, i, 1);
    if ch !~ '[0-9]' then
      raise exception 'serial_digits must be numeric';
    end if;
    d := ascii(ch) - 48;
    if idx % 2 = 0 then
      d := d * 2;
      if d > 9 then
        d := d - 9;
      end if;
    end if;
    total := total + d;
    idx := idx + 1;
  end loop;
  return (10 - (total % 10)) % 10;
end;
$$;

create or replace function public.student_code_from_serial(serial bigint)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  digits text;
begin
  if serial is null or serial < 1 or serial > 99999999 then
    raise exception 'student serial out of range';
  end if;
  digits := lpad(serial::text, 8, '0');
  return 'TP' || digits || public.student_code_luhn_check(digits)::text;
end;
$$;

create or replace function public.student_code_valid(code text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  digits text;
  serial_text text;
begin
  if code is null or length(code) <> 11 or substring(code from 1 for 2) <> 'TP' then
    return false;
  end if;
  digits := substring(code from 3 for 9);
  if digits !~ '^[0-9]{9}$' then
    return false;
  end if;
  serial_text := substring(digits from 1 for 8);
  if serial_text = '00000000' then
    return false;
  end if;
  return (substring(digits from 9 for 1))::integer
         = public.student_code_luhn_check(serial_text);
end;
$$;

revoke all on function public.student_code_luhn_check(text) from public, anon, authenticated;
revoke all on function public.student_code_from_serial(bigint) from public, anon, authenticated;
revoke all on function public.student_code_valid(text) from public, anon, authenticated;

-- Runtime (server-only) EXECUTE tối thiểu: triggers + check constraint cần gọi
-- các hàm này. Browser roles không có quyền gì.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.student_code_luhn_check(text) to service_role;
    grant execute on function public.student_code_from_serial(bigint) to service_role;
    grant execute on function public.student_code_valid(text) to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
    grant execute on function public.student_code_luhn_check(text) to tpro_runtime;
    grant execute on function public.student_code_from_serial(bigint) to tpro_runtime;
    grant execute on function public.student_code_valid(text) to tpro_runtime;
  end if;
end;
$$;

-- ===========================================================================
-- 3. Expand students (nullable until parity)
-- ===========================================================================
alter table public.students
  add column if not exists student_code text;

alter table public.students
  drop constraint if exists students_student_code_format_check;
alter table public.students
  add constraint students_student_code_format_check
    check (student_code is null or public.student_code_valid(student_code))
    not valid;

drop index if exists students_student_code_unique_idx;
create unique index students_student_code_unique_idx
  on public.students (student_code)
  where student_code is not null;

-- ===========================================================================
-- 4. Registry (append-only, no PII, server-only)
-- ===========================================================================
create table if not exists public.student_code_registry (
  code text primary key,
  issued_student_id uuid not null unique,
  format_version text not null default 'v1',
  issued_at timestamptz not null default now()
);

create or replace function public.block_student_code_registry_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'student code registry is append-only';
end;
$$;

revoke all on function public.block_student_code_registry_mutation() from public, anon, authenticated;

drop trigger if exists trg_student_code_registry_append_only on public.student_code_registry;
create trigger trg_student_code_registry_append_only
before update or delete on public.student_code_registry
for each row execute function public.block_student_code_registry_mutation();

drop trigger if exists trg_student_code_registry_no_truncate on public.student_code_registry;
create trigger trg_student_code_registry_no_truncate
before truncate on public.student_code_registry
for each statement execute function public.block_student_code_registry_mutation();

alter table public.student_code_registry enable row level security;
alter table public.student_code_registry force row level security;
revoke all on table public.student_code_registry from public, anon, authenticated;

-- ===========================================================================
-- 5. Backfill (stable order created_at,id; immutable evidence per run_id)
-- ===========================================================================
create table if not exists public._migration_055_student_code_backfill (
  run_id text not null default 'M055-R6',
  student_id uuid not null primary key,
  student_code text not null,
  issued_serial bigint not null,
  format_version text not null,
  backed_up_at timestamptz not null default now()
);

alter table public._migration_055_student_code_backfill enable row level security;
alter table public._migration_055_student_code_backfill force row level security;
revoke all on table public._migration_055_student_code_backfill from public, anon, authenticated;

do $$
declare
  r record;
  serial bigint;
  code text;
  total bigint;
  coded bigint;
begin
  select count(*) into total from public.students;
  select count(*) into coded from public.students where student_code is not null;
  if total > 0 and coded = 0 then
    for r in
      select id from public.students
       where student_code is null
       order by created_at asc, id asc
    loop
      serial := nextval('public.student_code_serial_seq');
      code := public.student_code_from_serial(serial);
      insert into public.student_code_registry (code, issued_student_id, format_version)
        values (code, r.id, 'v1');
      insert into public._migration_055_student_code_backfill
        (run_id, student_id, student_code, issued_serial, format_version)
        values ('M055-R6', r.id, code, serial, 'v1');
      update public.students set student_code = code where id = r.id;
    end loop;
    raise notice 'M055 backfill done: % students', total;
  else
    raise notice 'M055 backfill skipped (already coded or empty)';
  end if;
end;
$$;

-- ===========================================================================
-- 6. Switch write path: DB-authoritative allocation, immutable code
-- ===========================================================================
create or replace function public.students_allocate_student_code()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  serial bigint;
  code text;
begin
  if new.student_code is not null then
    raise exception 'student_code is assigned by the database and cannot be supplied';
  end if;
  serial := nextval('public.student_code_serial_seq');
  code := public.student_code_from_serial(serial);
  insert into public.student_code_registry (code, issued_student_id, format_version)
    values (code, new.id, 'v1');
  new.student_code := code;
  return new;
end;
$$;

revoke all on function public.students_allocate_student_code() from public, anon, authenticated;

drop trigger if exists trg_students_allocate_student_code on public.students;
create trigger trg_students_allocate_student_code
before insert on public.students
for each row execute function public.students_allocate_student_code();

create or replace function public.students_block_student_code_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.student_code is distinct from old.student_code then
    raise exception 'student_code is immutable once issued';
  end if;
  return new;
end;
$$;

revoke all on function public.students_block_student_code_change() from public, anon, authenticated;

drop trigger if exists trg_students_block_student_code_change on public.students;
create trigger trg_students_block_student_code_change
before update of student_code on public.students
for each row execute function public.students_block_student_code_change();

-- ===========================================================================
-- 7. Acceptance
-- ===========================================================================
do $$
declare
  total_students bigint;
  coded_students bigint;
  registry_rows bigint;
  invalid_rows bigint;
  duplicate_rows bigint;
begin
  select count(*) into total_students from public.students;
  select count(*) into coded_students from public.students where student_code is not null;
  select count(*) into registry_rows from public.student_code_registry;
  select count(*) into invalid_rows
    from public.students
   where student_code is not null and not public.student_code_valid(student_code);
  select count(*) into duplicate_rows
    from (select student_code from public.students where student_code is not null group by student_code having count(*) > 1) x;

  if coded_students <> total_students then
    raise exception 'M055 acceptance failed: % of % students missing a code', total_students - coded_students, total_students;
  end if;
  if registry_rows < total_students then
    raise exception 'M055 acceptance failed: registry rows (%) < students (%)', registry_rows, total_students;
  end if;
  if invalid_rows > 0 or duplicate_rows > 0 then
    raise exception 'M055 acceptance failed: invalid=% duplicate=%', invalid_rows, duplicate_rows;
  end if;
  raise notice 'M055 acceptance OK: students=% coded=% registry=% invalid=% dup=%',
    total_students, coded_students, registry_rows, invalid_rows, duplicate_rows;
end;
$$;

commit;
