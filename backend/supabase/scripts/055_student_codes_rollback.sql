-- R6-D04 055 rollback (compatibility): removes the write-path triggers and
-- drops the registry/evidence/sequence ONLY when no runtime consumer exists
-- (disposable acceptance). Historical evidence is preserved by default: the
-- script aborts when any non-empty backfill evidence exists unless the
-- calling runner explicitly passes -v FORCE_DROP_EVIDENCE=1.
\set ON_ERROR_STOP on

do $$
begin
  if current_setting('FORCE_DROP_EVIDENCE', true) <> '1'
     and exists (select 1 from public._migration_055_student_code_backfill) then
    raise exception 'M055 rollback abort: backfill evidence exists; use forward-fix instead';
  end if;
end;
$$;

drop trigger if exists trg_students_allocate_student_code on public.students;
drop trigger if exists trg_students_block_student_code_change on public.students;
drop function if exists public.students_allocate_student_code();
drop function if exists public.students_block_student_code_change();
drop trigger if exists trg_student_code_registry_append_only on public.student_code_registry;
drop trigger if exists trg_student_code_registry_no_truncate on public.student_code_registry;
drop table if exists public.student_code_registry;
drop table if exists public._migration_055_student_code_backfill;
drop sequence if exists public.student_code_serial_seq;
drop function if exists public.student_code_luhn_check(text);
drop function if exists public.student_code_from_serial(bigint);
drop function if exists public.student_code_valid(text);
