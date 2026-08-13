# SES bounce/complaint feedback — what to create in AWS

Everything here is done once, in the **eu-central-1 (Frankfurt)** region, because that is where the
SMTP endpoint we send through lives (`email-smtp.eu-central-1.amazonaws.com`). A topic in another
region cannot receive these events.

Steps 1–6 are yours and can be done now. Step 7 needs the receiving endpoint deployed first — it is
called out where it matters.

---

## Why this exists

Today a bounce is invisible to us. SES tells `hello@orbetra.com` in a human-readable notice and the
platform never learns, which costs us in two places:

- someone who mistypes their address at signup never gets the activation link, cannot log in, and
  vanishes without anyone noticing;
- **the billing lapse ladder advances on SEND, not on delivery** — a customer whose billing contact
  address is dead is recorded as warned three times and then has their fleet cut off, having been
  warned into a void. That is the one that hurts a paying customer.

---

## 0 — Look at where we stand (2 minutes, do this first)

**SES console → Account dashboard** (region eu-central-1). Read the **Reputation metrics** panel:
bounce rate and complaint rate.

- Under 5% bounce / 0.1% complaint is healthy.
- The rates are computed over a rolling window of recent sending. At our volume a single bad address
  moves the number a lot, so treat a spike as "look at what we sent", not "we are in trouble".

While you are here: **SES → Configuration → Suppression list**. Confirm account-level suppression is
enabled for **Bounce** and **Complaint**. This is AWS's own protection — an address that hard-bounced
is refused on the next send instead of bouncing again. It does not tell us anything, which is what
the rest of this guide fixes, but it stops one bad address becoming ten bounces.

---

## 1 — Create the SNS topic

**SNS console → Topics → Create topic**

| Field | Value |
|---|---|
| Type | **Standard** (FIFO cannot receive SES events) |
| Name | `orbetra-ses-events` |
| Display name | leave blank |

Everything else stays default. Press Create and **copy the ARN** — it looks like
`arn:aws:sns:eu-central-1:123456789012:orbetra-ses-events` (the middle number is your AWS account id,
shown in the console's top-right account menu).

**Keep it — you WILL need to paste it.** The endpoint accepts feedback from this one topic only, and
refuses everything when the value is missing, so it goes into `/opt/orbetra/.env` as
`SES_SNS_TOPIC_ARN=…` before step 7 (see the warning there). A signature alone cannot be trusted:
the same regional certificate signs every AWS customer's topics, so without this binding anyone with
an AWS account could publish a fake bounce for any address of ours.

Lost it later? **SNS console → Topics →** `orbetra-ses-events` — the ARN is at the top of the detail
page. Or from a shell with AWS credentials:

```sh
aws sns list-topics --region eu-central-1 --query "Topics[?contains(TopicArn,'orbetra-ses-events')].TopicArn" --output text
```

---

## 2 — Create the configuration set

A configuration set is the thing that says "publish events about these messages". Without one, SES
sends the mail and reports nothing.

**SES console → Configuration → Configuration sets → Create set**

| Field | Value |
|---|---|
| Configuration set name | `orbetra-prod` |
| Everything else | default |

---

## 3 — Point the configuration set at the topic

**Open `orbetra-prod` → Event destinations tab → Add destination**

**Event types** — tick:

- **Hard bounces** — the address does not exist. This is the one that matters.
- **Complaints** — the recipient pressed "spam". Rarer and more serious: it must stop us mailing
  them at all.
- **Deliveries** *(optional)* — useful later if you want "was this actually delivered" per message.

Leave **Soft bounces** off: a full mailbox or a temporary server problem retries by itself, and
treating it as a dead address would suppress a live customer.

**Destination**

| Field | Value |
|---|---|
| Destination type | **Amazon SNS** |
| SNS topic | `orbetra-ses-events` |
| Name | `sns-events` |

The console adds the topic policy that lets SES publish to it. If you ever recreate the topic by
hand, that policy has to allow `ses.amazonaws.com` to `SNS:Publish` — otherwise events are dropped
silently and nothing anywhere says so.

---

## 4 — Turn it on for our mail

The header that ties a message to the configuration set is only attached when the server knows the
name. On the server:

```
SES_CONFIG_SET=orbetra-prod
```

in `/opt/orbetra/.env`, then restart `api` and `worker`.

> It is currently present but **empty**, which reads as "not configured" in code — the header is
> never attached and every message is invisible to the configuration set. An empty value and a
> missing line behave identically here.

---

## 5 — Prove events are flowing, without hurting reputation

SES has a mailbox simulator whose addresses **do not affect your reputation metrics**. Use these and
nothing else for testing, forever:

| Address | What it does |
|---|---|
| `bounce@simulator.amazonses.com` | hard bounce |
| `complaint@simulator.amazonses.com` | complaint |
| `success@simulator.amazonses.com` | normal delivery |

Trigger one through the product — the simplest is **Forgot password** with the simulator address, or
a signup — and then check the topic received something: **SNS → Topics → `orbetra-ses-events` →
Monitoring**, look at `NumberOfMessagesPublished`. A non-zero count means steps 1–4 are correct.

At this point the events reach the topic and go nowhere. That is expected until step 7.

---

## 6 — (nothing to do) what is built on our side — **SHIPPED**

`POST /v1/webhooks/ses`:

- **verifies the SNS signature**, and fetches the certificate only from an
  `sns.<region>.amazonaws.com` host. Trusting `SigningCertURL` is how an endpoint like this gets
  broken: sign your own payload, host your own certificate, and the maths checks out perfectly.
  Unsigned or altered messages get a 403 and change nothing;
- answers the `SubscriptionConfirmation` handshake by itself, so step 7 confirms in seconds — with
  the same host check on `SubscribeURL`, which is a URL from the body we would otherwise fetch on
  request;
- records the address as undeliverable and **stops sending to it**, checked once on the single send
  path so no producer can forget;
- ignores **transient** bounces. A full mailbox clears by itself, and suppressing on it would
  silence a live customer permanently — this failure inverted;
- **blocks the lapse ladder for an unreachable contact.** The stage no longer advances when the
  warning cannot be delivered, so a customer we could not reach can never become ready to suspend.
  They stay lapsed and counted in `billing_lapse_unreachable_total` until someone fixes the address.

Step 4 (`SES_CONFIG_SET=orbetra-prod`) is already set on the server.

---

## 7 — Subscribe the topic to our endpoint (AFTER the endpoint is deployed)

> **⚠️ THE FEED IS ALREADY LIVE. Set `SES_SNS_TOPIC_ARN` BEFORE the next API deploy, not just
> before subscribing.**
>
> Steps 1–7 were completed earlier and verified with the SES simulator — a bounce for
> `bounce@simulator.amazonses.com` reached the endpoint and landed in `email_suppressions` on
> 2026-08-10. The subscription is confirmed and delivering.
>
> That means the topic check does not merely delay a feature that never started: **an api deploy
> without this variable stops a working one.** Every notification answers 403, SNS retries into those
> 403s, and after enough failures AWS disables the subscription — which then has to be recreated by
> hand. The api logs an explicit error at boot when the variable is missing, so the failure is at
> least visible in `docker logs orbetra-api-1` rather than silent.
>
> Get the ARN from **SNS console → Topics → `orbetra-ses-events`** (top of the detail page), put it in
> `/opt/orbetra/.env`, restart the api, and only then deploy.
> The endpoint accepts messages from exactly one topic. A valid AWS signature only proves *AWS* sent
> the message: the same regional certificate signs every AWS customer's topics, so without this
> binding anyone with an AWS account could publish a fake "permanent bounce" for any address and have
> it blackholed platform-wide (audit C2). The check therefore **fails closed** — with the variable
> unset the API refuses everything with 403, *including the subscription handshake below*, and the
> subscription will sit at **Pending confirmation** forever.
>
> ```sh
> # on the server, in /opt/orbetra/.env — copy the ARN from step 1
> SES_SNS_TOPIC_ARN=arn:aws:sns:eu-central-1:<account-id>:orbetra-ses-events
> ```
> Restart the api container, then create the subscription. A wrong ARN logs
> `SES: refused message from an unexpected SNS topic` — distinct from the signature refusal, so the
> two failures are never confused.

**SNS → Topics → `orbetra-ses-events` → Create subscription**

| Field | Value |
|---|---|
| Protocol | **HTTPS** |
| Endpoint | `https://dash.orbetra.com/v1/webhooks/ses` |
| Raw message delivery | **OFF** — leave unticked |

Raw message delivery must stay off: it strips the SNS envelope, and the envelope is what carries the
signature we verify. With it on, every message would be rejected as unsigned.

> **The app host, not the marketing one.** `orbetra.com` deliberately proxies only the handful of
> public paths the site needs — `/v1/public/*`, `/v1/partner/*`, `/r/*` — and everything else falls
> through to the SPA and answers 404. `dash.orbetra.com` carries the whole `/v1` surface, which is
> also where the Stripe webhook lives. Verified live: an unsigned POST there answers **403** and
> changes nothing.

The subscription shows **Pending confirmation** for a few seconds and then flips to **Confirmed** by
itself. If it stays pending, the endpoint is not reachable or not deployed — press **Request
confirmation** on the subscription after fixing it rather than recreating it.

---

## 8 — Final check

Send to `bounce@simulator.amazonses.com` once more. Within a few seconds:

- SNS → topic → Monitoring shows another published message;
- the address is in `email_suppressions` (ask me, or `SELECT * FROM email_suppressions`).

If the first happens and the second does not, the problem is on our side, not in AWS — tell me and
send the timestamp.

---

## Things worth knowing afterwards

**Never test with a real-looking domain you do not own.** `auditas.lt` has Google MX records but no
such mailbox, so it produced a genuine hard bounce against our reputation. The simulator addresses
above exist precisely so this never has to happen. Reserved TLDs (`.test`, `.invalid`, `.example`)
are refused by our own code before they reach SES, so those are safe too.

**A complaint is not a bounce.** A hard bounce means the address is wrong; a complaint means a real
person marked us as spam. AWS treats complaints far more harshly — 0.1% is the threshold, versus 5%
for bounces — so a complaint should always stop all mail to that address permanently, which is what
the endpoint will do.
