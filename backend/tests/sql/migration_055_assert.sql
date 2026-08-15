-- R6-D04 055 assert: students = non-null codes = registry rows; zero invalid,
-- zero duplicate, zero orphan; immutability + allocation triggers active.
\set ON_ERROR_STOP on

do $$
declare
  total_students bigint;
  coded_students bigint;
  registry_rows bigint;
  invalid_rows bigint;
  orphan_rows bigint;
  code_col varchar;
  allocated_code varchar;
  probe_id uuid := '30000000-0000-0000-0000-000000000551';
begin
  select count(*) into total_students from public.students;
  select count(*) into coded_students from public.students where student_code is not null;
  select count(*) into registry_rows from public.student_code_registry;
  select count(*) into invalid_rows
    from public.students
   where student_code is not null and not public.student_code_valid(student_code);
  select count(*) into orphan_rows
    from public.student_code_registry r
   where not exists (select 1 from public.students s where s.id = r.issued_student_id);

  if coded_students <> total_students then
    raise exception 'T-DB055-001: coded (%) <> total (%)', coded_students, total_students;
  end if;
  if registry_rows <> coded_students then
    raise exception 'T-DB055-002: registry (%) <> coded (%)', registry_rows, coded_students;
  end if;
  if invalid_rows <> 0 or orphan_rows <> 0 then
    raise exception 'T-DB055-003: invalid=% orphan=%', invalid_rows, orphan_rows;
  end if;

  -- Backfill theo order ổn định: issued_serial khớp thứ tự (created_at,id)
  -- của students — mapping evidence không được đảo thứ tự giữa các lần chạy.
  if exists (
    select 1
      from (
        select s.id,
               row_number() over (order by s.created_at asc, s.id asc) as rn
          from public.students s
         where s.student_code is not null
      ) s
      join public._migration_055_student_code_backfill b
        on b.student_id = s.id
     where b.issued_serial <> s.rn
  ) then
    raise exception 'T-DB055-004: backfill mapping not aligned with (created_at,id) order';
  end if;

  -- Vector khóa TP000000018 / TP123456782 khớp giữa Python/SQL.
  if public.student_code_from_serial(1) <> 'TP000000018'
     or public.student_code_from_serial(12345678) <> 'TP123456782' then
    raise exception 'T-DB055-005: SQL Luhn vector mismatch';
  end if;

  -- Insert mới được DB cấp mã; caller-supplied code bị reject.
  insert into public.students (id, full_name, status)
  values (probe_id, 'M055 Allocated', 'active')
  returning student_code into allocated_code;
  if allocated_code is null or not public.student_code_valid(allocated_code) then
    raise exception 'T-DB055-006: insert did not allocate a valid code';
  end if;

  begin
    insert into public.students (id, full_name, status, student_code)
    values ('30000000-0000-0000-0000-000000000552', 'M055 Caller', 'active', 'TP000000018');
    raise exception 'T-DB055-007: caller-supplied code unexpectedly accepted';
  exception
    when others then
      if sqlstate <> 'P0001' then
        raise;
      end if;
  end;

  -- UPDATE mã bị chặn.
  begin
    update public.students
       set student_code = 'TP123456782'
     where id = probe_id;
    raise exception 'T-DB055-008: student_code update unexpectedly allowed';
  exception
    when others then
      if sqlstate <> 'P0001' then
        raise;
      end if;
  end;

  -- Registry append-only.
  begin
    update public.student_code_registry set format_version = 'v9';
    raise exception 'T-DB055-009: registry update unexpectedly allowed';
  exception
    when others then
      if sqlstate <> 'P0001' then
        raise;
      end if;
  end;
  begin
    delete from public.student_code_registry;
    raise exception 'T-DB055-010: registry delete unexpectedly allowed';
  exception
    when others then
      if sqlstate <> 'P0001' then
        raise;
      end if;
  end;

  -- Registry/evidence deny browser roles.
  if exists (
    select 1 from pg_policy p
     join pg_class c on c.oid = p.polrelid
    where c.relname in ('student_code_registry', '_migration_055_student_code_backfill')
      and (p.polroles = '{}'::oid[] or p.polroles && array(
            select oid from pg_roles where rolname in ('anon', 'authenticated')))
  ) then
    raise exception 'T-DB055-011: browser roles can access registry/evidence';
  end if;
end;
$$;
