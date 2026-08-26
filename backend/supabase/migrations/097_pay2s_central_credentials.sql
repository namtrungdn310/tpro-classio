-- 097 — encrypted, Dev-managed credentials for the shared Pay2S mode.
--
-- Plaintext credentials never enter PostgreSQL. FastAPI encrypts them with
-- AUTH_ENCRYPTION_KEY before calling the narrow ops function below. Browser
-- roles receive neither table access nor function EXECUTE.

begin;

alter table ops.platform_pay2s_settings
  add column if not exists access_key_ciphertext text,
  add column if not exists secret_key_ciphertext text,
  add column if not exists collection_partner_code text,
  add column if not exists merchant_id text,
  add column if not exists credentials_updated_at timestamptz;

alter table ops.platform_pay2s_settings
  drop constraint if exists platform_pay2s_credentials_pair_check;
alter table ops.platform_pay2s_settings
  add constraint platform_pay2s_credentials_pair_check check (
    (access_key_ciphertext is null and secret_key_ciphertext is null)
    or
    (access_key_ciphertext is not null and secret_key_ciphertext is not null)
  );

create or replace function ops.platform_pay2s_setting()
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'operating_mode', operating_mode,
    'updated_at', updated_at,
    'central_credentials_configured',
      access_key_ciphertext is not null and secret_key_ciphertext is not null,
    'central_partner_code_configured',
      nullif(btrim(collection_partner_code), '') is not null,
    'central_merchant_id_configured',
      nullif(btrim(merchant_id), '') is not null,
    'credentials_updated_at', credentials_updated_at
  )
  from ops.platform_pay2s_settings
  where singleton
$$;

create or replace function ops.platform_pay2s_credentials()
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'access_key_ciphertext', access_key_ciphertext,
    'secret_key_ciphertext', secret_key_ciphertext,
    'collection_partner_code', collection_partner_code,
    'merchant_id', merchant_id,
    'credentials_updated_at', credentials_updated_at
  )
  from ops.platform_pay2s_settings
  where singleton
$$;

create or replace function ops.set_platform_pay2s_credentials(
  next_access_key_ciphertext text,
  next_secret_key_ciphertext text,
  next_collection_partner_code text,
  next_merchant_id text,
  actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  changed_at timestamptz := clock_timestamp();
  clean_partner_code text := nullif(btrim(next_collection_partner_code), '');
  clean_merchant_id text := nullif(btrim(next_merchant_id), '');
begin
  if char_length(coalesce(next_access_key_ciphertext, '')) < 32
     or char_length(coalesce(next_secret_key_ciphertext, '')) < 32 then
    raise exception 'Encrypted Pay2S credentials are required';
  end if;
  if clean_partner_code is null or char_length(clean_partner_code) > 160 then
    raise exception 'A valid Pay2S Collection Partner Code is required';
  end if;
  if clean_merchant_id is not null and char_length(clean_merchant_id) > 160 then
    raise exception 'Pay2S Merchant ID is too long';
  end if;

  update ops.platform_pay2s_settings
     set access_key_ciphertext = next_access_key_ciphertext,
         secret_key_ciphertext = next_secret_key_ciphertext,
         collection_partner_code = clean_partner_code,
         merchant_id = clean_merchant_id,
         credentials_updated_at = changed_at,
         updated_by = actor_id,
         updated_at = changed_at
   where singleton;

  insert into ops.platform_actions (
    actor_user_id, action, reason, result, metadata
  ) values (
    actor_id,
    'SET_PAY2S_CENTRAL_CREDENTIALS',
    'Dev updated the encrypted central Pay2S credentials.',
    'APPLIED',
    jsonb_build_object(
      'partner_code_configured', true,
      'merchant_id_configured', clean_merchant_id is not null
    )
  );

  return jsonb_build_object(
    'configured', true,
    'partner_code_configured', true,
    'merchant_id_configured', clean_merchant_id is not null,
    'credentials_updated_at', changed_at
  );
end;
$$;

do $$
declare
  runtime_role name;
begin
  for runtime_role in
    select rolname
      from pg_roles
     where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    execute format('grant usage on schema ops to %I', runtime_role);
    execute format(
      'grant execute on function ops.platform_pay2s_credentials() to %I',
      runtime_role
    );
    execute format(
      'grant execute on function ops.set_platform_pay2s_credentials(text, text, text, text, uuid) to %I',
      runtime_role
    );
  end loop;
end;
$$;

revoke all on function ops.platform_pay2s_credentials()
  from public, anon, authenticated;
revoke all on function ops.set_platform_pay2s_credentials(text, text, text, text, uuid)
  from public, anon, authenticated;

commit;
