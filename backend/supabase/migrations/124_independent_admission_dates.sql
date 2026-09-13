-- Expand only: preserve every existing financial revision and fee snapshot.
-- Enable INDEPENDENT_BILLING_DATES_ENABLED only after compatible writers deploy.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.enrollments
  add column if not exists admission_version integer not null default 0
    check (admission_version >= 0);

alter table public.start_date_change_commands
  add column if not exists operation_kind text not null default 'LEGACY_DATE_CHANGE'
    check (operation_kind in ('LEGACY_DATE_CHANGE', 'ADMISSION_DATE_CHANGE', 'CLASS_ADMISSION_DATE_CHANGE'));

alter table public.start_date_change_command_items
  drop constraint if exists start_date_change_command_items_decision_code_check;
alter table public.start_date_change_command_items
  add constraint start_date_change_command_items_decision_code_check check (
    decision_code in ('KEEP_EXISTING_SCHEDULE', 'KEEP_CURRENT_THEN_REANCHOR',
      'REANCHOR_CURRENT_CYCLE', 'REANCHOR_NEXT_BOUNDARY', 'REANCHOR_CUSTOM_BOUNDARY',
      'ACADEMIC_ONLY')
  ) not valid;
alter table public.start_date_change_command_items
  validate constraint start_date_change_command_items_decision_code_check;
alter table public.start_date_change_command_items
  alter column first_anchor_cycle_no drop not null;
alter table public.start_date_change_command_items
  drop constraint if exists start_date_change_items_academic_shape;
alter table public.start_date_change_command_items
  add constraint start_date_change_items_academic_shape check (
    decision_code <> 'ACADEMIC_ONLY' or (
      previous_billing_revision_id is not distinct from next_billing_revision_id
      and first_anchor_cycle_no is null and selected_historical_cycles is null
      and superseded_fee_count = 0 and skipped_cycle_count = 0
      and review_fee_record_id is null
    )
  ) not valid;
alter table public.start_date_change_command_items
  validate constraint start_date_change_items_academic_shape;

-- Check both directions at commit: a class edit must not invalidate untouched
-- admissions. No UPDATE/backfill of historical academic or financial data.
create or replace function public.check_class_admission_start_boundary()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare target_class uuid;
begin
  if tg_table_name = 'classes' then
    target_class := new.id;
  else
    target_class := new.class_id;
  end if;
  if exists (
    select 1 from public.enrollments e
    join public.classes c on c.id = e.class_id and c.workspace_id = e.workspace_id
    where c.id = target_class and e.status <> 'cancelled'
      and e.enrollment_date < c.start_date
  ) then
    raise exception using errcode = '23514',
      message = 'CLASS_ADMISSION_START_CONFLICT: class start must not follow an admission';
  end if;
  return null;
end;
$$;
drop trigger if exists class_admission_start_boundary on public.classes;
create constraint trigger class_admission_start_boundary
after update of start_date on public.classes
deferrable initially deferred for each row
when (old.start_date is distinct from new.start_date)
execute function public.check_class_admission_start_boundary();
drop trigger if exists enrollment_class_start_boundary on public.enrollments;
create constraint trigger enrollment_class_start_boundary
after insert or update of enrollment_date, class_id on public.enrollments
deferrable initially deferred for each row
execute function public.check_class_admission_start_boundary();

commit;
