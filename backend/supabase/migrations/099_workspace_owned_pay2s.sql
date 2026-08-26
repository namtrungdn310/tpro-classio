-- 099 — retire the unsupported shared Pay2S account model.
--
-- Every Dev/Admin profile already belongs to exactly one workspace. From this
-- migration onward, that workspace must own its Pay2S credentials, linked bank
-- accounts and webhook registrations. Historical shared-mode rows are kept for
-- audit, but they are disabled and must be configured again with workspace keys.

begin;

-- Stop callbacks before changing provider rows so an old shared credential can
-- no longer post into a workspace after this migration commits.
update public.workspace_payment_webhooks webhook
   set status = 'disabled',
       last_error = 'Pay2S dùng chung đã ngừng hỗ trợ; workspace cần kết nối lại.',
       updated_at = clock_timestamp()
  from public.workspace_payment_providers provider
 where webhook.provider_id = provider.id
   and provider.provider = 'pay2s'
   and provider.connection_mode = 'central';

update public.workspace_payment_accounts account
   set provider_status = 'disabled',
       updated_at = clock_timestamp()
 where exists (
   select 1
     from public.workspace_payment_providers provider
    where provider.workspace_id = account.workspace_id
      and provider.provider = 'pay2s'
      and provider.connection_mode = 'central'
 )
   and (account.provider_bank_id is not null or account.provider_account_id is not null);

update public.workspace_payment_providers
   set connection_mode = 'byo',
       status = 'not_configured',
       merchant_id = null,
       partner_code = null,
       collection_partner_code = null,
       access_key_ciphertext = null,
       secret_key_ciphertext = null,
       bearer_token_ciphertext = null,
       bearer_token_expires_at = null,
       connected_at = null,
       last_error = 'Hãy kết nối tài khoản Pay2S riêng của workspace.',
       updated_at = clock_timestamp()
 where provider = 'pay2s'
   and connection_mode = 'central';

alter table public.workspace_payment_providers
  alter column connection_mode set default 'byo';
alter table public.workspace_payment_providers
  drop constraint if exists workspace_payment_providers_connection_mode_check;
alter table public.workspace_payment_providers
  add constraint workspace_payment_providers_connection_mode_check
  check (connection_mode = 'byo');

-- Remove the global credential surface. Migration history remains immutable,
-- while the live schema no longer stores or exposes a central Pay2S secret.
revoke all on function ops.set_platform_pay2s_credentials(text, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function ops.platform_pay2s_credentials()
  from public, anon, authenticated;
revoke all on function ops.set_platform_pay2s_mode(text, uuid)
  from public, anon, authenticated;
revoke all on function ops.platform_pay2s_setting()
  from public, anon, authenticated;
revoke all on function ops.platform_pay2s_mode()
  from public, anon, authenticated;

drop function if exists ops.set_platform_pay2s_credentials(text, text, text, text, uuid);
drop function if exists ops.platform_pay2s_credentials();
drop function if exists ops.set_platform_pay2s_mode(text, uuid);
drop function if exists ops.platform_pay2s_setting();
drop function if exists ops.platform_pay2s_mode();
drop table if exists ops.platform_pay2s_settings;

insert into ops.platform_actions (
  action, reason, result, metadata
) values (
  'RETIRE_PAY2S_CENTRAL_MODE',
  'Retired unsupported shared Pay2S credentials and enforced workspace ownership.',
  'APPLIED',
  jsonb_build_object('connection_mode', 'byo')
);

commit;
