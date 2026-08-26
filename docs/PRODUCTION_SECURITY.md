# TPRO production security runbook

This runbook is the deployment contract for a production installation. It is
deliberately separate from application credentials and must be reviewed before
the first public release.

## Network boundary

1. Put the application behind Cloudflare DNS, WAF and a named Cloudflare
   Tunnel.
2. Publish `app.example.com` to the frontend service and expose only
   `hooks.example.com/webhooks/pay2s` plus
   `hooks.example.com/webhooks/pay2s/ipn` to the backend callback routes.
3. Put the Dev operations UI behind a separate `ops.example.com` Cloudflare
   Access application. Require the Dev identity and a recent AAL2 session in
   TPRO as defence in depth.
4. Do not publish backend/frontend ports to a public interface. If a local
   binding is temporarily needed during migration, bind only to loopback and
   remove it after the tunnel is healthy.
5. Allow only outbound tunnel traffic and the exact external dependencies
   needed by Supabase, Pay2S, Google and the configured notification provider.

`docker-compose.cloudflare.yml` is an overlay for the immutable deploy
compose. Use two tunnel replicas for production; a healthy tunnel does not
prove that the application or database is healthy, so retain independent
health checks.

## Edge controls

- Use Cloudflare managed WAF rules and targeted rate-limit rules for login,
  registration, password reset, OTP, invitations and expensive exports.
- Use Turnstile on public authentication abuse points and validate its token
  server-side. Do not put Turnstile or interactive Access in front of the Pay2S
  webhook.
- Keep the callback host limited to `POST /webhooks/pay2s` and
  `POST /webhooks/pay2s/ipn`. The first route validates Pay2S's per-webhook
  Bearer token; the second validates the signed Collection Link result. Both
  routes bound request size and apply replay protection before any payment
  mutation.
- Webhook retries are serialized by provider transaction and checked against
  the append-only delivery ledger before financial mutation. Keep the
  transaction batch cap and body cap unchanged unless a measured provider
  contract requires a reviewed migration.
- Do not enable Free Bot Fight Mode until the full callback and synthetic test
  suite passes; its challenge pipeline cannot be skipped by normal WAF rules.
- Trust client IP headers only when the request arrives through the private
  tunnel/proxy path.

## Secrets and data

- Store Cloudflare tunnel tokens, Pay2S keys and encryption roots in the
  deployment secret manager. Never put them in the browser, screenshots or
  application logs.
- Rotate tunnel/API tokens and Pay2S webhook tokens independently.
- Never log raw bank payloads, OTPs, Access/Secret Keys or parent contact data.
- Keep database TLS verification enabled and test backup restore before go-live.
- The Dev operations API exposes aggregates only. It must not become a global
  read endpoint for student or parent PII.

## Incident response

- Pay2S mismatch or replay: quarantine, do not mark paid; investigate from the
  request reference and provider transaction ID.
- Pay2S outage: disable Pay2S for the affected Admin unit and continue with
  manual QR/reference collection.
- Database saturation: pause exports and non-critical workers first.
- Tunnel degradation: route through the second replica and page the operator.
- Suspected credential leak: disable the affected provider/workspace, revoke
  sessions, rotate the secret, and review the append-only audit trail.

The Dev-only `/settings/system` operations center refreshes aggregate workspace
health, payment-review counts, and callback quarantine signals. Its only current
automated circuit breaker is disabling Pay2S for one Admin unit; it
never deletes data, reverses payments, or changes administrator roles.

Never use an automatic action to delete data, run a migration, reverse a
financial ledger entry or permanently disable an administrator.
