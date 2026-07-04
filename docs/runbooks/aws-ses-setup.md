# AWS SES setup (E00-2, human runbook)

SES sends our notification e-mails (W5, E05-4). New accounts start in **sandbox**
(can only mail verified addresses) — the production-access request is human-reviewed
and takes 1–3 days, hence "submit early".

**Prerequisite: the product domain must exist** (E00-5 — Orbetra domain not bought yet?
buy it first; SES verifies a DOMAIN).

## Steps

1. **AWS account**: https://aws.amazon.com → Create account (card required; SES cost
   is ~€0.10 per 1000 mails — effectively zero for us).
2. Console top-right **region: Europe (Frankfurt) eu-central-1** — do everything there.
3. **Verify the domain**: Amazon SES → Verified identities → Create identity →
   *Domain* → enter `<yourdomain>` → keep "Easy DKIM" (RSA_2048) on → SES shows
   **3 CNAME records** → add them at your DNS provider → wait for "Verified" (minutes
   to hours).
4. **Verify your own e-mail too** (Create identity → Email address) — lets you test
   while still in sandbox.
5. **Custom MAIL FROM** (recommended, SPF alignment): identity → Advanced →
   MAIL FROM domain `mail.<yourdomain>` → add the MX + TXT records SES shows.
6. **Request production access**: SES → Account dashboard → *Request production
   access*. Fill:
   - Mail type: **Transactional**
   - Website URL: your domain
   - Use-case description (paste, adjust):
     > Orbetra is a B2B GPS fleet-tracking platform. SES sends transactional
     > notifications only: geofence entry/exit alerts, device-offline warnings,
     > panic-button alerts and password resets, exclusively to registered platform
     > users who configured these notifications. Expected volume < 10,000/month
     > initially. Bounces and complaints are consumed via SES notifications and
     > offending addresses are disabled automatically. No marketing e-mail is sent.
   - Expected volume: 10,000/mo · Compliance answers: yes to honoring bounces/complaints.
7. Wait for approval mail (24–72 h; they occasionally ask a follow-up question).
8. **Credentials for the app**: SES → SMTP settings → *Create SMTP credentials*
   (creates an IAM user) → save SMTP endpoint (`email-smtp.eu-central-1.amazonaws.com:587`),
   username and password → these become `SMTP_URL` + `MAIL_FROM=alerts@<yourdomain>`
   in staging `.env` (§6.7). Store them in a password manager, never in the repo.

Done — E05-4 will consume the creds; nothing else needed until W5.
