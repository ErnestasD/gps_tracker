# ADR-036 — A white-label tenant sends mail from their OWN domain

Status: accepted (2026-08-07)
Supersedes nothing. Related: E03-5 (custom domains), ADR-023 (SMTP transport), ROADMAP-post-v1 item 13.

## The problem

Everything a reseller's customer sees is theirs — the login page, the colours, the logo, the tab,
the links in the mail. Except the one line no branding can cover:

```
From: Orbetra <hello@orbetra.com>
```

The body is perfectly white-labelled and the sender gives the whole thing away, on every activation,
every password reset and every overspeed alert. The marketing site sells "White-label domain, logo,
colours. Orbetra never appears in-app **or in emails** to your end customers"; today the second half
is false.

`MAIL_FROM` is a single process-wide env var (ADR-023), so this is not a display bug — the platform
has exactly one sending identity and every tenant borrows it.

## The decision

**Verify the tenant's domain as a sending identity in OUR SES account (DKIM), then set `From` to
their address on their own messages.** The tenant publishes three CNAME records; we send.

The existing SMTP transport is unchanged — SES accepts any `From` on a verified identity, so this is
one header, not a second delivery path. The AWS SDK is needed only to create the identity and read
its verification state: two calls, on a settings screen, never on the send path.

## Why not the alternatives

**Per-tenant SMTP credentials** (the tenant pastes their own host/user/password). Tempting — no new
dependency, nodemailer already does it, and their reputation is their problem. Rejected on the thing
the founder is actually optimising for: support time. When their provider throttles, rewrites the
envelope, or expires an app password, the customer sees "Orbetra stopped sending my alerts" and we
cannot see anything at all — no bounce, no log, no lever. It also means storing a live credential
for someone else's mail system, which is a category of secret this platform does not currently hold
and would have to protect for as long as the customer exists.

**A neutral platform domain** (`mail.fleetnotify.io` or similar). A WHOIS lookup and one curious
customer later, it is the same leak with an extra domain to renew. It also splits our sending
reputation across two identities for no benefit.

**Sending unauthenticated as their domain** — that is spoofing. It fails DMARC, lands in spam, and
is exactly what SPF and DKIM exist to stop. Not an option, listed only because "just change the From
header" is the obvious first idea and it is wrong.

## What the tenant does

The same shape as the custom-domain flow they have already been through, deliberately: publish DNS
records, click Verify.

1. Settings → Branding → **Sending domain**: type `klientas.lt`, choose the address (`alertai@`).
2. We create the SES identity and show **three CNAME records** (DKIM) plus one optional MAIL FROM
   record. They publish them.
3. Click Verify. SES reports `SUCCESS` and we store the address.
4. Every message for that tenant now goes out as `Fleet Klientas <alertai@klientas.lt>`.

Until step 3 completes, mail keeps going out on the platform identity — an unverified domain must
never silently stop a customer's alerts.

## Consequences we accept

- **Their bounces land on our SES reputation.** Mitigated with a per-tenant SES configuration set so
  the metrics are attributable, and an identity can be deleted. This is the real cost of the
  decision and it is the reason a sending domain is a TSP-plan entitlement, not a free-tier toggle.
- **A new runtime dependency** (`@aws-sdk/client-sesv2`) in apps/api — the reason this ADR exists
  (hard rule 10). Scoped to two calls; the send path keeps using nodemailer.
- **New AWS credentials.** The server today holds SES *SMTP* credentials only, which cannot manage
  identities. An IAM user limited to `ses:CreateEmailIdentity`, `ses:GetEmailIdentity`,
  `ses:DeleteEmailIdentity` and `ses:PutEmailIdentityMailFromAttributes` is required. Absent them the
  feature is inert and the UI says so — the same live-but-disabled pattern as the SMS gateway
  (ADR-032), so a missing credential is never a broken screen.
- **DMARC alignment stays the tenant's call.** DKIM signing makes us aligned; if they publish a
  strict DMARC policy with no SPF include, mail still passes on DKIM alone. Documented in the guide
  rather than enforced, because their DNS is theirs.
