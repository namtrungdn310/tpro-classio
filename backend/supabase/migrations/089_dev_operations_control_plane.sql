-- 089 — Dev-only operations control plane.
--
-- The application role never receives raw cross-workspace tables.  These
-- security-definer functions expose only aggregate operational metadata and
-- a narrow Pay2S circuit-breaker command.  The owner of this migration is the
-- only role that can read all workspaces through the function body.

begin;

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

create table if not exists ops.platform_actions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  action text not null,
  reason text not null,
  result text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint platform_actions_reason_check check (char_length(reason) between 8 and 500),
  constraint platform_actions_metadata_check check (jsonb_typeof(metadata) = 'object')
);

alter table ops.platform_actions enable row level security;
alter table ops.platform_actions force row level security;
revoke all on table ops.platform_actions from public, anon, authenticated;

create or replace function ops.platform_overview()
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
with workspace_rows as (
  select
    w.id,
    w.name,
    w.owner_user_id,
    coalesce(admins.admin_count, 0) as admin_count,
    coalesce(admins.active_admin_count, 0) as active_admin_count,
    coalesce(requests.open_request_count, 0) as open_request_count,
    coalesce(requests.review_request_count, 0) as review_request_count,
    coalesce(deliveries.quarantined_count, 0) as quarantined_count,
    providers.status as provider_status,
    providers.connection_mode,
    left(providers.last_error, 500) as provider_last_error,
    deliveries.last_received_at
  from public.workspaces w
  left join (
    select
      workspace_id,
      count(*) filter (where role = 'admin') as admin_count,
      count(*) filter (where role = 'admin' and account_status = 'active') as active_admin_count
    from public.profiles
    group by workspace_id
  ) admins on admins.workspace_id = w.id
  left join (
    select
      workspace_id,
      count(*) filter (where status = 'OPEN') as open_request_count,
      count(*) filter (where status = 'REVIEW') as review_request_count
    from public.payment_requests
    group by workspace_id
  ) requests on requests.workspace_id = w.id
  left join (
    select
      workspace_id,
      count(*) filter (where status in ('QUARANTINED', 'FAILED', 'DEAD')) as quarantined_count,
      max(received_at) as last_received_at
    from public.payment_provider_deliveries
    group by workspace_id
  ) deliveries on deliveries.workspace_id = w.id
  left join lateral (
    select p.status, p.connection_mode, p.last_error
    from public.workspace_payment_providers p
    where p.workspace_id = w.id and p.provider = 'pay2s'
    order by p.updated_at desc
    limit 1
  ) providers on true
)
select jsonb_build_object(
  'generated_at', clock_timestamp(),
  'status', case
    when exists (select 1 from workspace_rows where provider_status = 'error')
      or exists (select 1 from workspace_rows where review_request_count > 0)
      or exists (select 1 from workspace_rows where quarantined_count > 0)
    then 'degraded'
    else 'operational'
  end,
  'workspaces', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', id,
        'name', name,
        'owner_user_id', owner_user_id,
        'admin_count', admin_count,
        'active_admin_count', active_admin_count,
        'open_request_count', open_request_count,
        'review_request_count', review_request_count,
        'quarantined_count', quarantined_count,
        'provider_status', coalesce(provider_status, 'not_configured'),
        'connection_mode', coalesce(connection_mode, 'manual'),
        'provider_last_error', provider_last_error,
        'last_received_at', last_received_at
      ) order by name, id
    ) from workspace_rows
  ), '[]'::jsonb),
  'incidents', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'incident_id', incident_id,
        'severity', severity,
        'title', title,
        'summary', summary
      ) order by severity_rank, incident_id
    )
    from (
      select
        'pay2s-provider-error'::text as incident_id,
        'high'::text as severity,
        2 as severity_rank,
        'Pay2S cần kiểm tra'::text as title,
        'Một hoặc nhiều workspace đang lỗi kết nối Pay2S.'::text as summary
      where exists (select 1 from workspace_rows where provider_status = 'error')
      union all
      select
        'payment-review-queue'::text,
        'medium'::text,
        3,
        'Có giao dịch cần đối soát'::text,
        'Một hoặc nhiều yêu cầu thanh toán đang chờ kiểm tra thủ công.'::text
      where exists (select 1 from workspace_rows where review_request_count > 0)
      union all
      select
        'payment-webhook-quarantine'::text,
        'high'::text,
        2,
        'Webhook bị cách ly'::text,
        'Có callback Pay2S không khớp hoặc đã thất bại.'::text
      where exists (select 1 from workspace_rows where quarantined_count > 0)
    ) item
  ), '[]'::jsonb)
);
$$;

create or replace function ops.disable_workspace_pay2s(
  target_workspace_id uuid,
  actor_id uuid,
  action_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  changed integer;
begin
  if char_length(coalesce(action_reason, '')) not between 8 and 500 then
    raise exception 'A reason of 8-500 characters is required';
  end if;
  update public.workspace_payment_providers
     set status = 'disabled',
         last_error = left(action_reason, 500),
         updated_at = clock_timestamp()
   where workspace_id = target_workspace_id
     and provider = 'pay2s';
  get diagnostics changed = row_count;
  if changed > 0 then
    insert into ops.platform_actions (
      actor_user_id, workspace_id, action, reason, result, metadata
    ) values (
      actor_id, target_workspace_id, 'DISABLE_PAY2S', action_reason, 'APPLIED', '{}'::jsonb
    );
  end if;
  return changed > 0;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
    grant usage on schema ops to tpro_runtime;
    grant execute on function ops.platform_overview() to tpro_runtime;
    grant execute on function ops.disable_workspace_pay2s(uuid, uuid, text) to tpro_runtime;
  end if;
end;
$$;

revoke all on function ops.platform_overview() from public, anon, authenticated;
revoke all on function ops.disable_workspace_pay2s(uuid, uuid, text) from public, anon, authenticated;

commit;
