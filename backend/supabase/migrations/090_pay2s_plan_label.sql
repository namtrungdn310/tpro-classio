-- Do not imply that Pay2S offers a free plan.  'unconfirmed' is TPRO's local
-- state until the connected Pay2S account confirms its external subscription.
begin;
alter table public.workspace_payment_providers
  alter column plan set default 'unconfirmed';
update public.workspace_payment_providers
   set plan = 'unconfirmed'
 where plan = 'free' and status = 'not_configured';
commit;
