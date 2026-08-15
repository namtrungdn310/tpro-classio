-- R6-D04 055 assert-before: no student_code infrastructure exists yet.
\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.student_code_registry') is not null then
    raise exception 'T-DB055-100: registry already exists before migration';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'students'
       and column_name = 'student_code'
  ) then
    raise exception 'T-DB055-101: student_code column already exists before migration';
  end if;
end;
$$;
