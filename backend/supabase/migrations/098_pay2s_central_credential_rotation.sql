-- 098 — fail closed after rotating the shared Pay2S credentials.
--
-- A cached bearer token belongs to the previous Access/Secret Key pair. Every
-- central workspace must therefore be verified again after Dev rotates the
-- shared credentials; otherwise the UI could report a stale connected state.

begin;

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

  update public.workspace_payment_providers
     set bearer_token_ciphertext = null,
         bearer_token_expires_at = null,
         connected_at = null,
         status = 'pending_verification',
         last_error = null,
         updated_by = actor_id,
         updated_at = changed_at
   where provider = 'pay2s'
     and connection_mode = 'central';

  insert into ops.platform_actions (
    actor_user_id, action, reason, result, metadata
  ) values (
    actor_id,
    'SET_PAY2S_CENTRAL_CREDENTIALS',
    'Dev updated the encrypted central Pay2S credentials.',
    'APPLIED',
    jsonb_build_object(
      'partner_code_configured', true,
      'merchant_id_configured', clean_merchant_id is not null,
      'central_connections_invalidated', true
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

revoke all on function ops.set_platform_pay2s_credentials(text, text, text, text, uuid)
  from public, anon, authenticated;

commit;
