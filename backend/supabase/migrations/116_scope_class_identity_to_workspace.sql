begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Class identities belong to a workspace. The indexes introduced before
-- workspace isolation accidentally made an otherwise valid class name collide
-- with the same identity in every other tenant.
do $$
begin
  if exists (
    select 1
      from public.classes
     where identity_scheme = 'ACADEMIC_YEAR'
       and cancelled_at is null
     group by workspace_id, class_category, lower(btrim(name)),
              coalesce(grade_level, 0), coalesce(academic_year_start, 0)
    having count(*) > 1
  ) then
    raise exception '116 preflight failed: duplicate academic class identity inside a workspace';
  end if;

  if exists (
    select 1
      from public.classes
     where identity_scheme = 'INTAKE'
       and class_category is not null
       and cancelled_at is null
     group by workspace_id, class_category, lower(btrim(name)), intake_year_month
    having count(*) > 1
  ) then
    raise exception '116 preflight failed: duplicate intake class identity inside a workspace';
  end if;
end $$;

drop index if exists public.classes_academic_identity_unique_idx;
drop index if exists public.classes_intake_identity_unique_idx;
drop index if exists public.classes_unclassified_academic_identity_unique_idx;
drop index if exists public.classes_unclassified_intake_identity_unique_idx;

create unique index classes_academic_identity_unique_idx
  on public.classes (
    workspace_id,
    class_category,
    lower(btrim(name)),
    coalesce(grade_level, 0),
    coalesce(academic_year_start, 0)
  )
  where identity_scheme = 'ACADEMIC_YEAR' and cancelled_at is null;

create unique index classes_intake_identity_unique_idx
  on public.classes (workspace_id, class_category, lower(btrim(name)), intake_year_month)
  where identity_scheme = 'INTAKE'
    and class_category is not null
    and cancelled_at is null;

create unique index classes_unclassified_academic_identity_unique_idx
  on public.classes (workspace_id, lower(btrim(name)), grade_level, academic_year_start)
  where identity_scheme = 'ACADEMIC_YEAR'
    and class_category is null
    and cancelled_at is null;

create unique index classes_unclassified_intake_identity_unique_idx
  on public.classes (workspace_id, lower(btrim(name)), intake_year_month)
  where identity_scheme = 'INTAKE'
    and class_category is null
    and cancelled_at is null;

do $$
declare
  index_definition text;
begin
  select pg_get_indexdef('public.classes_academic_identity_unique_idx'::regclass)
    into index_definition;
  if index_definition is null or position('workspace_id' in index_definition) = 0 then
    raise exception '116 acceptance failed: academic identity is not workspace scoped';
  end if;

  select pg_get_indexdef('public.classes_intake_identity_unique_idx'::regclass)
    into index_definition;
  if index_definition is null or position('workspace_id' in index_definition) = 0 then
    raise exception '116 acceptance failed: intake identity is not workspace scoped';
  end if;
end $$;

commit;
