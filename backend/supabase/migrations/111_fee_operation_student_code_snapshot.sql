-- Preserve the stable student identity inside the immutable fee-operation
-- ledger. Reports must not depend on the current student profile row.
begin;

alter table public.fee_operation_items
  add column if not exists student_code_snapshot text;

update public.fee_operation_items item
set student_code_snapshot = student.student_code
from public.students student
where item.student_id = student.id
  and item.workspace_id = student.workspace_id
  and item.student_code_snapshot is null;

alter table public.fee_operation_items
  drop constraint if exists fee_operation_items_student_code_snapshot_check;

alter table public.fee_operation_items
  add constraint fee_operation_items_student_code_snapshot_check
  check (
    student_code_snapshot is null
    or student_code_snapshot ~ '^TP[0-9]{9}$'
  ) not valid;

alter table public.fee_operation_items
  validate constraint fee_operation_items_student_code_snapshot_check;

create index if not exists ix_fee_operation_items_student_code
  on public.fee_operation_items (workspace_id, student_code_snapshot)
  where student_code_snapshot is not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fee_operation_items'
      and column_name = 'student_code_snapshot'
  ) then
    raise exception '111 acceptance failed: fee operation student code snapshot is missing';
  end if;
end $$;

commit;
