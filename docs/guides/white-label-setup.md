# Running the platform under your own brand

A guide for partners on a **TSP plan**. Everything here is done by you, in your own account and your
own DNS. It takes about twenty minutes, plus however long your DNS provider takes to publish.

By the end, your customers sign in at your address, see your logo and colours, and receive mail from
you. Our name appears nowhere.

---

## Before you start

You need two things:

- **A domain you control**, or at least the ability to add records to it. A subdomain is enough and
  is what we recommend — `fleet.yourcompany.com` rather than `yourcompany.com` itself.
- **Access to your DNS records.** Usually your domain registrar's control panel, sometimes your
  hosting provider or IT department. If you are not sure which, look up who your domain's
  nameservers point to.

You do **not** need a server, a certificate, or anything installed. We handle all of that.

---

## Part 1 — Your address (10 minutes)

### Option A: use a subdomain of ours (instant, no DNS)

If you want to be live today, or you cannot get a DNS change scheduled, take a name under our
platform domain in **Settings → Branding → Domains → Subdomain**. Type a name, press Add, and it
works within seconds. Nothing else to do.

The trade-off is that the address itself is not yours. Choose this to start; move to your own domain
whenever you like — both work at the same time, so there is no cut-over.

### Option B: your own domain (recommended)

**Step 1 — add it.** Settings → Branding → Domains → *My own domain*. Enter the exact hostname your
customers will use, for example `fleet.yourcompany.com`. Press Add.

**Step 2 — prove it is yours.** We show a TXT record. Add it to your DNS:

| Field | Value |
|---|---|
| Type | `TXT` |
| Name / Host | `fleet` — see the note on names below |
| Value | `orbetra-verify=…` (copy it exactly from the screen) |
| TTL | leave the default |

**Step 3 — point it at us.** This is a **separate record** and the step people miss. Proving you own
the domain does not make it lead anywhere.

| Field | Value |
|---|---|
| Type | `CNAME` |
| Name / Host | `fleet` |
| Value / Target | `dash.orbetra.com` (copy the exact target shown on the screen) |
| TTL | leave the default |

**Step 4 — press Verify.** If it says the TXT record was not found, your DNS has not published yet;
wait and try again. Most providers take a few minutes, some up to an hour.

**Step 5 — open your address in a browser.** The secure certificate is issued automatically on that
first visit and takes a few seconds. Nothing to install, nothing to renew — ever.

> **About the "Name" field.** Some control panels want just the prefix (`fleet`), others want the
> whole hostname (`fleet.yourcompany.com`), and a few want a trailing dot
> (`fleet.yourcompany.com.`). If you enter the full name in a panel that expects the prefix, you end
> up with `fleet.yourcompany.com.yourcompany.com` — a record that looks saved and resolves to
> nothing. When in doubt, enter the prefix only, save, and then check what the panel displays back
> to you.

---

## Part 2 — Your look (5 minutes)

Settings → Branding.

| Field | What it does | Advice |
|---|---|---|
| Product name | Replaces our name everywhere — screens, e-mail headers, page titles | Your product's name, not your legal entity |
| Logo URL | Shown on the sign-in page, in the sidebar, in e-mails, and as the browser tab icon | Must be `https://`. A wide PNG or SVG about 200×50 px. Host it somewhere permanent |
| Primary colour | Buttons, links, highlights | `#rrggbb`. We automatically lighten or darken it if it would be unreadable on the background |
| Accent colour | Secondary highlights | Optional |
| Support e-mail | Shown in the footer of every e-mail we send for you | Your support address — this is who your customers will reply to |

Your logo doubles as the browser tab icon, so a square-ish mark reads better there than a long
wordmark. If you have both, use the wordmark.

---

## Part 3 — Your sending address (10 minutes)

Without this step, e-mail arrives from our address. Everything inside the message is yours; the
"From" line is not.

Settings → Branding → **Sending domain**.

**Step 1** — enter the domain you want to send from (`yourcompany.com`) and the mailbox name
(`alerts`, `noreply`, `fleet` — anything). Press Add.

**Step 2** — we show **three CNAME records**. Add all three to your DNS exactly as shown:

| Field | Value |
|---|---|
| Type | `CNAME` |
| Name / Host | `xxxxxxxx._domainkey` (three different ones) |
| Value / Target | `xxxxxxxx.dkim.amazonses.com` |

These are DKIM keys. They let mail servers confirm the message really came from your domain, which
is what stops it landing in spam.

**Step 3** — press Verify. This can take up to an hour after the records are published; it is the
slowest step in this guide and there is nothing to do but wait.

Until it verifies, mail keeps going out from our address rather than failing — your customers never
lose an alert because a DNS record is still propagating.

> **If you already send mail from that domain** — you almost certainly do — nothing here interferes
> with it. DKIM records are additive. If you publish a `DMARC` policy, our mail passes on DKIM
> alignment alone; you do not need to add anything to your SPF record.

---

## Part 4 — Check it (2 minutes)

1. Open your address in a **private/incognito window**. You should see your logo and colours on the
   sign-in page, your name in the browser tab, and no mention of us anywhere.
2. Use **Forgot password** with your own address. The mail should come from your sending address,
   carry your logo, and its link should point back at *your* domain — not ours.
3. Open the site on a phone. Add it to the home screen; the icon and name should be yours.

If any of those still shows our name, tell us — it is a bug on our side, not a setting you missed.

---

## Common problems

**"TXT record not found" when I press Verify.**
Almost always propagation — wait and retry. If it persists past an hour, check the record's name in
your panel (see the note in Part 1) and that you copied the whole value including `orbetra-verify=`.

**The badge says Verified but my address does not open.**
The TXT record proves ownership; the CNAME routes the traffic. Step 3 in Part 1 is missing.

**The browser warns the certificate is invalid.**
You reached us before the certificate was issued. Wait thirty seconds and reload. If it continues,
your domain is pointing somewhere else — check the CNAME target.

**My customers' mail goes to spam.**
Finish Part 3. Unverified sending domains are the single biggest cause. If it persists after
verification, check whether your domain has a strict DMARC policy that was written before you had
DKIM.

**I want to move from your subdomain to my own domain.**
Add the new domain, verify it, and use it. Both keep working, so there is no downtime; remove the
old one when you are ready. Anything your customers bookmarked on the old address stops working
when you remove it, so leave it in place for a while.

---

## What we handle, so you do not have to

Certificates and their renewal · hosting and backups of your customers' data · the tracking
infrastructure itself · e-mail delivery, bounces and reputation · security updates.

You handle: your DNS records, your logo, and what you charge your customers.
