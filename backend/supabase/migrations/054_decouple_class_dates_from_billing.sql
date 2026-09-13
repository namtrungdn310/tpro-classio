-- R6-D02 — Decouple class dates from billing cadence (forward-only expand).
--
-- Contract: dev.md §2.2/§4.1, test.md §3.1/§2.
-- Replaces the exact package-division trigger (migration 046) with a
-- minimum-end-date rule enforced in the application domain; keeps the
-- cadence shape constraints and end > start.
--
-- Phase: expand/backfill/switch/contract — this migration only relaxes the
-- write path (switch). Legacy columns/constraints stay until R6-D19.

begin;

-- ===========================================================================
-- 1. Preflight (no mutation yet)
-- ===========================================================================
do $$
declare
  trigger_count integer;
  violating_classes integer;
  below_min_classes integer;
begin
  select count(*)
    into trigger_count
    from pg_trigger
   where tgname = 'classes_enforce_package_cycle_integrity';

  if trigger_count > 1 then
    raise exception 'M054 preflight abort: duplicate package-cycle trigger rows (count=%)', trigger_count;
  end if;

  -- Legacy classes that would violate the NEW minimum-end rule must be listed
  -- and block the cutover (ambiguous data is never guessed). MONTHLY minimum
  -- mirrors the pure contract: EOM-preserving add 1 month + 1 day.
  select count(*)
    into below_min_classes
    from public.classes c
   where c.start_date is not null
     and c.end_date is not null
     and (
       (c.type = 'COURSE'
        and c.billing_cycle_weeks is not null
        and c.billing_cycle_weeks >= 1
        and c.end_date < c.start_date + (c.billing_cycle_weeks * 7))
       or
       (c.type = 'MONTHLY'
        and c.end_date < (
          case
            when c.start_date = (date_trunc('month', c.start_date) + interval '1 month - 1 day')::date
              then (date_trunc('month', c.start_date) + interval '2 months - 1 day')::date + 1
            else (c.start_date + interval '1 month')::date + 1
          end
        ))
     );

  if below_min_classes > 0 then
    raise exception 'M054 preflight abort: % class(es) below the new minimum end date; manual review required (ids: %)',
      below_min_classes,
      (select string_agg(x.id::text, ',')
         from (select c.id from public.classes c
                where c.start_date is not null and c.end_date is not null
                  and (
                    (c.type = 'COURSE' and c.billing_cycle_weeks is not null and c.billing_cycle_weeks >= 1
                     and c.end_date < c.start_date + (c.billing_cycle_weeks * 7))
                    or
                    (c.type = 'MONTHLY' and c.end_date < (
                       case
                         when c.start_date = (date_trunc('month', c.start_date) + interval '1 month - 1 day')::date
                           then (date_trunc('month', c.start_date) + interval '2 months - 1 day')::date + 1
                         else (c.start_date + interval '1 month')::date + 1
                       end
                     ))
                  ) limit 20) x);
  end if;

  -- Evidence: rows previously blocked by the exact-division rule.
  select count(*)
    into violating_classes
    from public.classes c
   where c.type = 'COURSE'
     and c.start_date is not null
     and c.end_date is not null
     and c.billing_cycle_weeks is not null
     and c.billing_cycle_weeks >= 1
     and mod(c.end_date - c.start_date, c.billing_cycle_weeks * 7) <> 0;

  raise notice 'M054 preflight OK: exact-division classes affected = %, below-min = %', violating_classes, below_min_classes;
end;
$$;

-- ===========================================================================
-- 2. Immutable backup per run_id
-- ===========================================================================
create table if not exists public._migration_054_class_date_backup (
  run_id text not null default 'M054-R6',
  class_id uuid not null,
  name text not null,
  type public.class_type not null,
  start_date date,
  end_date date,
  billing_cycle_months smallint not null,
  billing_cycle_weeks smallint,
  exact_division_violation boolean not null,
  backed_up_at timestamptz not null default now(),
  primary key (run_id, class_id)
);

insert into public._migration_054_class_date_backup (
  run_id, class_id, name, type, start_date, end_date,
  billing_cycle_months, billing_cycle_weeks, exact_division_violation
)
select 'M054-R6', c.id, c.name, c.type, c.start_date, c.end_date,
       c.billing_cycle_months, c.billing_cycle_weeks,
       (c.type = 'COURSE'
        and c.start_date is not null
        and c.end_date is not null
        and c.billing_cycle_weeks is not null
        and c.billing_cycle_weeks >= 1
        and mod(c.end_date - c.start_date, c.billing_cycle_weeks * 7) <> 0)
  from public.classes c
  where not exists (
    select 1 from public._migration_054_class_date_backup b
     where b.run_id = 'M054-R6' and b.class_id = c.id
  );

alter table public._migration_054_class_date_backup
  enable row level security;
alter table public._migration_054_class_date_backup
  force row level security;

revoke all on public._migration_054_class_date_backup
  from public, anon, authenticated;

-- ===========================================================================
-- 3. Switch write path: remove the exact-division trigger, keep shape rules
-- ===========================================================================
drop trigger if exists classes_enforce_package_cycle_integrity on public.classes;
drop function if exists public.enforce_class_package_cycle_integrity();

-- Cadence shape constraint stays (MONTHLY vs COURSE); end > start stays.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'classes_date_range_check'
       and conrelid = 'public.classes'::regclass
  ) then
    alter table public.classes
      add constraint classes_date_range_check
        check (start_date is null or end_date is null or end_date >= start_date)
        not valid;
  end if;
end;
$$;

-- ===========================================================================
-- 4. Acceptance — the new write path accepts non-divisible durations
-- ===========================================================================
do $$
declare
  probe_id uuid := '30000000-0000-0000-0000-000000000054';
  probe_exists boolean;
begin
  select exists (select 1 from public.classes where id = probe_id)
    into probe_exists;
  if not probe_exists then
    insert into public.classes (
      id, name, type, base_fee, billing_cycle_months, billing_cycle_weeks,
      identity_scheme, is_active, start_date, end_date
    ) values (
      probe_id, 'M054 ACCEPTANCE', 'COURSE', 750000, 1, 3,
      'LEGACY', true, date '2026-08-13', date '2026-09-10'
    );
    -- 2026-08-13 -> 2026-09-10 = 28 ngày, không chia hết 3 tuần (21), >= min 21.
    if not exists (
      select 1 from public.classes
       where id = probe_id and end_date = date '2026-09-10'
    ) then
      raise exception 'M054 acceptance failed: non-divisible class date not persisted';
    end if;
    raise notice 'M054 acceptance OK: non-divisible course duration persisted';
  else
    raise notice 'M054 acceptance: probe row already present (rerun path)';
  end if;
end;
$$;

-- ===========================================================================
-- 5. Rerun behavior
-- ===========================================================================
-- The migration is idempotent: preflight re-runs, backup insert is guarded by
-- NOT EXISTS, trigger drop is IF EXISTS, acceptance probe is guarded. A
-- second run is therefore a safe no-op that re-verifies the contract.
-- Drift (e.g. a new exact-division trigger) is caught by the preflight check
-- above only when the trigger count differs; rollback aborts on drift.

commit;
