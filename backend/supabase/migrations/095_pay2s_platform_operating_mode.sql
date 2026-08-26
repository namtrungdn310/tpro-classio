-- 095 — One Dev-controlled Pay2S operating mode for the whole platform.
--
-- `central` means TPRO's Dev-operated Pay2S Partner credentials are used;
-- admins may view the connection but cannot alter the shared account. `byo`
-- means each workspace supplies and owns its own Pay2S credentials. Existing
-- provider rows are preserved during a mode change so historical callbacks
-- remain auditable; new QR creation is guarded by the application mode check.

begin;

create table if not exists ops.platform_pay2s_settings (
  singleton boolean primary key default true check (singleton),
  operating_mode text not null default 'central'
    check (operating_mode in ('central', 'byo')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into ops.platform_pay2s_settings (singleton, operating_mode)
values (true, 'central')
on conflict (singleton) do nothing;

alter table ops.platform_pay2s_settings enable row level security;
alter table ops.platform_pay2s_settings force row level security;
revoke all on table ops.platform_pay2s_settings from public, anon, authenticated;

create or replace function ops.platform_pay2s_mode()
returns text
language sql
security definer
stable
set search_path = pg_catalog
as $$
  select coalesce(
    (select operating_mode from ops.platform_pay2s_settings where singleton),
    'central'
  )
$$;

create or replace function ops.platform_pay2s_setting()
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'operating_mode', operating_mode,
    'updated_at', updated_at
  )
  from ops.platform_pay2s_settings
  where singleton
$$;

create or replace function ops.set_platform_pay2s_mode(
  next_mode text,
  actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  previous_mode text;
  changed_at timestamptz := clock_timestamp();
begin
  if next_mode not in ('central', 'byo') then
    raise exception 'Unsupported Pay2S operating mode';
  end if;

  select operating_mode
    into previous_mode
    from ops.platform_pay2s_settings
   where singleton
   for update;

  update ops.platform_pay2s_settings
     set operating_mode = next_mode,
         updated_by = actor_id,
         updated_at = changed_at
   where singleton;

  insert into ops.platform_actions (
    actor_user_id, action, reason, result, metadata
  ) values (
    actor_id,
    'SET_PAY2S_OPERATING_MODE',
    'Dev updated the platform Pay2S operating mode.',
    'APPLIED',
    jsonb_build_object(
      'previous_mode', coalesce(previous_mode, 'central'),
      'operating_mode', next_mode
    )
  );

  return jsonb_build_object(
    'operating_mode', next_mode,
    'updated_at', changed_at
  );
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
    grant usage on schema ops to tpro_runtime;
    grant execute on function ops.platform_pay2s_mode() to tpro_runtime;
    grant execute on function ops.platform_pay2s_setting() to tpro_runtime;
    grant execute on function ops.set_platform_pay2s_mode(text, uuid) to tpro_runtime;
  end if;
end;
$$;

revoke all on function ops.platform_pay2s_mode() from public, anon, authenticated;
revoke all on function ops.platform_pay2s_setting() from public, anon, authenticated;
revoke all on function ops.set_platform_pay2s_mode(text, uuid) from public, anon, authenticated;

commit;
