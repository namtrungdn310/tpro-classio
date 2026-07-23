-- Preserve the billing dates that were in effect when a fee record was created.
-- Historical notified/paid records must not change when an enrollment anchor moves.
alter table fee_records
  add column if not exists due_date date,
  add column if not exists enrollment_date_snapshot date;

with billing_context as (
  select
    fr.id,
    e.enrollment_date,
    c.type,
    greatest(c.billing_cycle_months, 1)::int as cycle_months,
    to_date(fr.period || '-01', 'YYYY-MM-DD') as month_start,
    (to_date(fr.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
      as month_end
  from fee_records fr
  join enrollments e on e.id = fr.enrollment_id
  join classes c on c.id = e.class_id
  where e.enrollment_date is not null
    and fr.period ~ '^\d{4}-(0[1-9]|1[0-2])$'
), calculated as (
  select
    id,
    enrollment_date,
    month_start,
    month_end,
    type,
    cycle_months * 28 as cycle_days,
    case
      when type = 'MONTHLY' then
        make_date(
          extract(year from month_start)::int,
          extract(month from month_start)::int,
          least(
            extract(day from enrollment_date)::int,
            extract(day from month_end)::int
          )
        )
      else enrollment_date + (cycle_months * 28)
    end as first_candidate
  from billing_context
), due_dates as (
  select
    id,
    enrollment_date,
    case
      when type = 'MONTHLY' then
        case
          when first_candidate >= (
            enrollment_date + interval '1 month'
          )::date then first_candidate
          else null
        end
      when month_end < first_candidate then null
      when first_candidate >= month_start then first_candidate
      else
        first_candidate
        + (
          ceil(
            ((month_start - first_candidate)::numeric) / cycle_days
          )::int * cycle_days
        )
    end as candidate_due_date,
    month_end
  from calculated
)
update fee_records fr
set
  enrollment_date_snapshot = coalesce(fr.enrollment_date_snapshot, due_dates.enrollment_date),
  due_date = coalesce(
    fr.due_date,
    case
      when due_dates.candidate_due_date <= due_dates.month_end
        then due_dates.candidate_due_date
      else null
    end
  )
from due_dates
where fr.id = due_dates.id;

create index if not exists idx_fee_records_period_due_date
  on fee_records (period, due_date);
