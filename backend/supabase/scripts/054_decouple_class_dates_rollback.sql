-- R6-D02 rollback — restore the exact-division trigger ONLY when no new row
-- violates it (compatibility rollback); otherwise abort for forward-fix.
-- Never touches the backup evidence table.

begin;

do $$
declare
  drift_count integer;
begin
  select count(*)
    into drift_count
    from public.classes c
   where c.type = 'COURSE'
     and c.start_date is not null
     and c.end_date is not null
     and c.billing_cycle_weeks is not null
     and c.billing_cycle_weeks >= 1
     and mod(c.end_date - c.start_date, c.billing_cycle_weeks * 7) <> 0;

  if drift_count > 0 then
    raise exception 'M054 rollback abort: % class(es) violate the old exact-division rule; use forward-fix instead', drift_count;
  end if;
end;
$$;

create or replace function public.enforce_class_package_cycle_integrity()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  cycle_days integer;
begin
  if new.type::text = 'MONTHLY' then
    return new;
  end if;
  if new.billing_cycle_weeks is null or new.billing_cycle_weeks < 1 then
    raise exception 'course billing_cycle_weeks must be at least one';
  end if;
  if new.start_date is not null and new.end_date is not null then
    cycle_days := new.billing_cycle_weeks::integer * 7;
    if mod(new.end_date - new.start_date, cycle_days) <> 0 then
      raise exception 'class date range must contain complete billing packages';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_class_package_cycle_integrity()
  from public, anon, authenticated;

drop trigger if exists classes_enforce_package_cycle_integrity on public.classes;
create trigger classes_enforce_package_cycle_integrity
before insert or update of type, billing_cycle_months, billing_cycle_weeks, start_date, end_date
on public.classes
for each row execute function public.enforce_class_package_cycle_integrity();

commit;
