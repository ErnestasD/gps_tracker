# AWS SES setup (E00-2, human runbook)

SES sends Orbetra's notification e-mails (W5, E05-4: geofence/offline/panic/low-battery
alerts + password resets). New accounts start in **sandbox** (mail only to verified
addresses); the production-access request is human-reviewed (1–3 days) — submit early.

Region for EVERYTHING below: **Europe (Frankfurt) — eu-central-1** (EU data residency).

> **STATUS 2026-07-14: production access APPROVED** — 50,000 msg/day, 14 msg/s, out of
> sandbox. The code is WIRED (ADR-023, nodemailer SMTP behind the E05-5 dispatch seam). To
> GO LIVE, set these DISCRETE vars on the **worker** server `.env` (never in git — rule 12),
> then restart the worker:
> ```
> SMTP_HOST=email-smtp.eu-central-1.amazonaws.com
> SMTP_PORT=587                         # STARTTLS (default); 465 = implicit TLS
> SMTP_USER=<SES_SMTP_USERNAME>
> SMTP_PASS=<SES_SMTP_PASSWORD>         # paste RAW — do NOT URL-encode (discrete var, not a URL)
> MAIL_FROM=alerts@<domain>            # a DKIM-verified SES identity (see §2/§4)
> SES_CONFIG_SET=orbetra-notifications # optional but recommended — routes bounces/complaints
> ```
> **Why discrete vars, not one `SMTP_URL`:** SES SMTP passwords are base64 (`+ / =`); a `/`
> inside a URL password silently misparses as the path (wrong creds, every send auth-fails), and
> other chars crash the URL parser. Discrete host/port/user/pass sidesteps URL parsing entirely.
> Any missing var ⇒ the email channel is simply skipped (never a crash).
>
> Preconditions before real sends: domain identity **Verified** (DKIM), custom MAIL FROM
> records added (§4), and SMTP credentials created (§6). Bounce/complaint auto-suppression
> (SNS→webhook consuming the config-set events) is a documented FOLLOW-UP; until then use the
> SES console's bounce/complaint dashboards (volume is < 10k/month initially).

---

## 0. Prerequisites
- The product **domain** must exist (you have it now). SES verifies a domain.
- Access to the domain's **DNS** (where you add CNAME/TXT/MX records).

## 1. Create the AWS account
1. https://aws.amazon.com → **Create an AWS Account** (email, card — SES is ~€0.10 /1000
   mails, effectively €0 for us).
2. Sign in to the **Console**. Top-right region selector → **Europe (Frankfurt)
   eu-central-1**. Keep it there for every step.

## 2. Verify the domain (DKIM)
1. Console search → **Amazon SES** → left menu **Verified identities** → **Create identity**.
2. Choose **Domain**. Enter your domain (e.g. `yourdomain.com` — no https, no www).
3. Leave **Easy DKIM** on, key type **RSA_2048**. Leave "Publish DNS records to Route 53"
   OFF unless your DNS is in Route 53.
4. Click **Create identity**. SES shows **3 CNAME records** (names look like
   `xxxx._domainkey.yourdomain.com`).
5. Go to your DNS provider and add all **3 CNAME records** exactly as shown (name → value).
6. Back in SES the identity flips **Verified** in minutes–hours (DKIM status "Successful").

## 3. Verify your own e-mail (for sandbox testing)
Create identity → **Email address** → your personal email → confirm the link AWS mails you.
Lets you send test mail while still in sandbox.

## 4. Custom MAIL FROM (recommended — SPF alignment, better deliverability)
1. Open the domain identity → tab **Custom MAIL FROM domain** → **Edit**.
2. Subdomain: `mail` (→ `mail.yourdomain.com`). Behavior on failure: **Use default MAIL FROM**.
3. Save → SES shows **1 MX** and **1 TXT** record → add both at your DNS.

## 5. Request production access (the important one)
1. SES → **Account dashboard** → **Request production access** (top banner).
2. Fill in:
   - **Mail type:** Transactional
   - **Website URL:** your domain
   - **Use case description** (paste, adjust the domain/company):
     > Orbetra is a B2B GPS fleet-tracking platform. SES sends transactional
     > notifications only: geofence entry/exit alerts, device-offline warnings,
     > panic-button alerts, low-battery warnings and password-reset e-mails —
     > exclusively to registered platform users who explicitly configured these
     > notifications. Expected volume < 10,000/month initially. We consume SES
     > bounce and complaint notifications and automatically disable offending
     > recipients. No marketing or bulk e-mail is sent.
   - **Additional contacts / compliance:** confirm you handle bounces & complaints.
3. Submit → approval e-mail usually in 24–72 h (they may ask one follow-up question).

## 6. Create SMTP credentials (after approval, or now for sandbox testing)
1. SES → **SMTP settings** → **Create SMTP credentials** → creates an IAM user →
   **Download** the username + password (shown once).
2. Note the SMTP endpoint: `email-smtp.eu-central-1.amazonaws.com`, port **587** (STARTTLS).
3. These map to the worker `.env` as DISCRETE vars (PROJECT_PLAN §6.7; see the STATUS block above):
   - `SMTP_HOST=email-smtp.eu-central-1.amazonaws.com` · `SMTP_PORT=587`
   - `SMTP_USER=<SMTP_USERNAME>` · `SMTP_PASS=<SMTP_PASSWORD>` (paste raw — NOT a URL, no encoding)
   - `MAIL_FROM=alerts@yourdomain.com`
   Store in a password manager. NEVER commit to the repo (rule 12).

Done — nothing else needed until W5 (E05-4) consumes the creds. Hand the SMTP username +
password + MAIL_FROM to the build when W5 starts; they go into the staging secrets, not git.

## Quick sanity checklist
- [ ] Region = eu-central-1 everywhere
- [ ] Domain identity **Verified** (DKIM Successful)
- [ ] Custom MAIL FROM records added (MX + TXT)
- [ ] Production access **approved** (out of sandbox)
- [ ] SMTP credentials saved in a password manager
