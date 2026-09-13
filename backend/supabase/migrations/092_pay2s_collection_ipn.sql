-- R9.9 — Collection Link IPN and Partner transaction webhooks may observe
-- the same bank movement.  Keep one immutable provider-delivery fact for a
-- Pay2S transaction across both channels; application advisory locks are the
-- fast path, this unique index is the final database boundary.

begin;

do $$
begin
  if exists (
    select 1
    from public.payment_provider_deliveries
    where provider = 'pay2s'
      and provider_transaction_id is not null
    group by provider, provider_transaction_id
    having count(*) > 1
  ) then
    raise exception
      '092 preflight failed: duplicate Pay2S provider_transaction_id rows require reconciliation before enforcing idempotency';
  end if;
end;
$$;

create unique index if not exists payment_provider_deliveries_pay2s_transaction_uniq
  on public.payment_provider_deliveries (provider, provider_transaction_id)
  where provider = 'pay2s' and provider_transaction_id is not null;

commit;
