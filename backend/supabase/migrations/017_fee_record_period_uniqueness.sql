do $$
begin
  if exists (
    select 1
    from fee_records
    group by enrollment_id, period
    having count(*) > 1
  ) then
    raise exception 'Duplicate fee records exist; resolve them manually before applying uniqueness';
  end if;
end $$;

create unique index if not exists ux_fee_records_enrollment_period
  on fee_records (enrollment_id, period);
