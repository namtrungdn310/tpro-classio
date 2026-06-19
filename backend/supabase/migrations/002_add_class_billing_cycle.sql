-- Add billing cycle length for classes.
-- Run this once if 001_initial_schema.sql has already been applied.

alter table classes
add column if not exists billing_cycle_months smallint not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'classes_billing_cycle_months_check'
  ) then
    alter table classes
    add constraint classes_billing_cycle_months_check
    check (billing_cycle_months >= 1);
  end if;
end $$;
