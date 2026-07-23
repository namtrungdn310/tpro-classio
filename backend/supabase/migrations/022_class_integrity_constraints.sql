-- Mirror API invariants at the database boundary so trusted scripts and future
-- integrations cannot persist class records the application cannot interpret.
alter table public.classes
  drop constraint if exists classes_name_length_check,
  drop constraint if exists classes_base_fee_range_check,
  drop constraint if exists classes_type_billing_cycle_check,
  drop constraint if exists classes_date_range_check;

alter table public.classes
  add constraint classes_name_length_check
    check (char_length(btrim(name)) between 1 and 120),
  add constraint classes_base_fee_range_check
    check (base_fee >= 0 and base_fee <= 999999999999),
  add constraint classes_type_billing_cycle_check
    check (
      (type = 'MONTHLY' and billing_cycle_months = 1)
      or (type = 'COURSE' and billing_cycle_months in (2, 3, 6, 12))
    ),
  add constraint classes_date_range_check
    check (start_date is null or end_date is null or end_date >= start_date);
