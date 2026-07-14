# ADR-023: nodemailer for SMTP e-mail delivery

**Date:** 2026-07-14 · **Status:** accepted · **Story:** E05-5 (CLAUDE.md rule 10 gate)

## Context

E05-5 built the notification dispatch pipeline (PR #32) with an injected `EmailTransport`
seam (`apps/worker/src/notify/drivers.ts`) — deliberately leaving the concrete transport for
when AWS SES production access landed. It has now landed (2026-07-14: 50,000 msg/day, 14 msg/s,
eu-central-1, out of sandbox). Wiring real delivery needs an SMTP client — a new
`apps/worker` runtime dependency, so it needs the rule-10 paper trail.

## Decision

- **Adopt `nodemailer` in apps/worker** (MIT, the de-facto Node SMTP client, zero mandatory
  transitive deps of concern) as the concrete `EmailTransport`.
- **SMTP, not the SES API.** The transport reads the runbook's env contract verbatim —
  `SMTP_URL=smtp://<user>:<pass>@email-smtp.eu-central-1.amazonaws.com:587` + `MAIL_FROM`
  (docs/runbooks/aws-ses-setup.md §6). SMTP is provider-agnostic: it drives SES SMTP today and
  the **per-tenant custom SMTP/DKIM** roadmap item (PROJECT_PLAN §4 V2) with the SAME transport —
  a per-tenant `SMTP_URL` is the whole feature. The AWS SDK would lock us to SES and add a much
  larger dependency for no capability we need (bounces are tracked by SES regardless of send path).
- **Env-gated, like every other driver.** `buildEmailTransport(env)` returns `undefined` when
  `SMTP_URL`/`MAIL_FROM` are absent, so the email channel is SKIPPED (a config gap, not a failure) —
  identical to the Telegram token gate. No secret is ever in code (rule 12); creds live only in the
  server `.env`.
- **Bounce/complaint handling** (AWS-required for reputation): the transport forwards an optional
  `SES_CONFIG_SET` as the `X-SES-CONFIGURATION-SET` header so SES routes bounce/complaint events to
  a configured SNS destination. Consuming those events to auto-suppress recipients is a documented
  FOLLOW-UP (a small SNS→webhook + suppression list); until then SES's account-level bounce/complaint
  dashboards are the safety net, and volume is low (< 10k/month initially).

## Consequences

- One transport covers SES-now and custom-SMTP-later; swapping providers is an env change.
- `@types/nodemailer` is a dev-dep (justified in the PR description, allowed by rule 10).
- The send path stays behind BullMQ retry (attempts 5, exp backoff) — a transient SMTP error
  throws and the notify worker retries; a permanent one exhausts and is recorded (E05-5a).
- Deliverability depends on DKIM + custom MAIL FROM being verified in SES (runbook §2/§4) — an
  ops precondition, not code.
