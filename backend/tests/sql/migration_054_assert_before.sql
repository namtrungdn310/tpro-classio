-- R6-D02 assert-before: exact-division trigger is still enforced pre-migration.
\set ON_ERROR_STOP on

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'classes_enforce_package_cycle_integrity'
  ) then
    raise exception 'T-DB054-001: package-cycle trigger missing before migration';
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.classes (
      id, name, type, base_fee, billing_cycle_months, billing_cycle_weeks,
      identity_scheme, is_active, start_date, end_date
    ) values (
      '30000000-0000-0000-0000-0000000000b1', 'M054 BEFORE', 'COURSE', 750000, 1, 3,
      'LEGACY', true, date '2026-08-13', date '2026-09-10'
    );
    raise exception 'T-DB054-002: non-divisible insert unexpectedly accepted before migration';
  exception
    when others then
      if sqlstate <> 'P0001' then
        raise;
      end if;
  end;
end;
$$;
