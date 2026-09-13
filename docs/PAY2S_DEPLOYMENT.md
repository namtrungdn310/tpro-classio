# Pay2S deployment

TPRO uses one Pay2S account per workspace. There is no shared credential or
central Pay2S mode:

- an Admin connects the Pay2S account owned by that Admin's workspace;
- a Dev tests with the Pay2S account owned by a dedicated Dev workspace;
- credentials and receiving accounts cannot be selected across workspaces.

Access Key, Secret Key, bearer token and webhook token are server-only. The
backend encrypts stored secrets and never returns them to the browser.

## Payment flow

1. The workspace connects its Pay2S Access Key, Secret Key and Partner Code on
   the Banking page.
2. The workspace links a Pay2S-supported receiving bank account and completes
   OTP when required.
3. TPRO creates an inbound transaction webhook for that linked account.
4. On the Fees page, an Admin selects an unpaid fee and creates its payment
   request and QR. TPRO does not let a parent create a request.
5. The Admin sends that QR to the parent. Creating a QR alone never sends a
   message and never marks a fee as paid.
6. TPRO auto-posts only an inbound transaction whose normalized transfer
   content, amount and receiving account match the open payment request.
   Anything ambiguous is quarantined for review.
7. A payment request and all share actions are auditable; the financial ledger
   remains append-only and idempotent by provider transaction id.

Bank accounts not linked through Pay2S remain valid manual receiving accounts.
After receiving a manual transfer, the Admin records the fee and selects the
actual account that received it.

## Environment

```env
PAYMENT_PROVIDER=pay2s
PAYMENT_QR_ENABLED=true
PAYMENT_WEBHOOK_INGRESS_ENABLED=true
PAYMENT_AUTO_POST_ENABLED=false

PAY2S_API_BASE_URL=https://api-partner.pay2s.vn
PAY2S_COLLECTION_BASE_URL=https://payment.pay2s.vn
PAY2S_WEBHOOK_URL=https://api.example.com/webhooks/pay2s
PAY2S_IPN_URL=https://api.example.com/webhooks/pay2s/ipn
PAY2S_REDIRECT_URL=https://app.example.com/fees
PAY2S_HTTP_TIMEOUT_SECONDS=15
```

Pay2S credentials are entered per workspace in the Banking page; do not place
them in shared deployment environment variables.

Keep `PAYMENT_AUTO_POST_ENABLED=false` until both public HTTPS callback paths
are reachable and monitored. Test replay, duplicate, wrong amount, wrong
content and wrong-account callbacks before enabling it.

## Migrations

Run migrations through `101_payment_reconciliation_workspace.sql` in filename order.
Migration 099 retires the historical central/shared surface, clears shared
provider credentials and disables affected links so each workspace must
reconnect its own account. It also constrains `connection_mode` to the legacy
storage value `byo`; the field is no longer an application choice.

Migration 100 records the one-owner-per-workspace contract. `dev` is an
application-derived permission, not a value in `profiles.role`; the original
owner workspace is therefore the Dev staging workspace, while every invited
Admin receives a separately reserved workspace.

Migration 101 adds the workspace-scoped reconciliation snapshot and resolution
audit. Provider events that cannot be posted automatically appear under
**Báo cáo → Cần kiểm tra**. Only successful inbound transactions with a positive
amount and a known receiving account may be retried or manually matched;
outbound and failed events may only be ignored after review.

## Staging and production gate

Use the Dev workspace for the first real integration test:

1. Connect a dedicated Pay2S test account in the Dev workspace.
2. Link one receiving bank account and confirm the provider reports it active.
3. Verify the Partner webhook and Collection Link IPN use different HTTPS
   paths and resolve to the same Dev workspace only.
4. With automatic posting off, run signed negative callback tests.
5. Enable automatic posting and make one small real payment using a QR created
   from the Fees page.
6. Confirm exactly one fee payment is posted and a replay creates no duplicate.
7. Repeat connection setup independently in each production Admin workspace.

Pay2S signup, plan purchase and upgrade remain on Pay2S because no official
public provisioning/billing API is documented. TPRO links to that official
flow and never asks for a Pay2S password.
