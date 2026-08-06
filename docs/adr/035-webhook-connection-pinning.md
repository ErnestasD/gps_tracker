# ADR-035 — Pin webhook deliveries to the validated IP (close the DNS-rebinding gap)

**Status:** accepted, 2026-08-06 · **Supersedes nothing** · **New dependency:** none

## Context

`assertPublicUrl` (E06-4 review HIGH) resolves a webhook host and refuses loopback, link-local,
private, ULA, CGNAT and cloud-metadata targets. It has always carried a stated residual gap:

> undici (node fetch) re-resolves the hostname at connect time, so a record that changes between
> this lookup and undici's, or a multi-A round-robin, can still land on a private IP.

That is DNS rebinding, and the attacker is a tenant admin — someone who can set a webhook URL and
also control a DNS record. `attacker.example` answers with a public A record for our check, then with
`169.254.169.254` a millisecond later for the actual connection. Delivery runs inside the compose
network, so a success means our own metadata service, database or internal API is POSTed to with a
tenant-controlled body.

The original TODO said closing it "requires pinning the connection to the validated IP via a custom
undici dispatcher — a new runtime dep that needs an ADR (rule 10)".

## Decision

Close it with **no new dependency**, using `node:https` / `node:http` directly instead of `fetch`:

1. Resolve the host once and validate every returned address (unchanged — `assertPublicUrl`).
2. **Connect to that validated IP literally**, and carry the original hostname in the `Host` header
   and — for TLS — in `servername`, so SNI and certificate verification still check the real name.
3. Refuse redirects outright (they are the same escalation by another route, and a webhook endpoint
   has no business 302-ing).

There is no second resolution, so there is no window to rebind in. Certificate validation is
unchanged: `servername` + `checkServerIdentity` still bind the certificate to the hostname the tenant
configured, so pinning the address does not weaken TLS — it only removes the attacker's ability to
change WHICH machine answers.

## Alternatives rejected

- **`undici` as a direct dependency, with a custom dispatcher.** The idiomatic answer, and it would
  work — but it is a new runtime dependency on the outbound path for something node builtins already
  do. Rule 10 exists to make that trade explicit; here the builtin costs ~60 lines.
- **Re-validate after the request.** Too late: the request has already been made.
- **Only allow-list hostnames.** Refuses a legitimate product feature (customer-chosen endpoints).

## Scope: every caller, not just webhooks

`assertPublicUrl` has two callers, and pinning only one would have left the guard's own docstring
lying about the other. **Web push** (`notify/drivers.ts`) validates a BROWSER-SUPPLIED endpoint and
then hands it to `web-push`, which does its own `https.request` — a second resolution, verbatim the
same hole, on a request that carries a VAPID `Authorization` header from inside the prod network.
It is pinned the same way, via an `https.Agent` whose `lookup` returns the validated address;
`web-push` accepts an `agent` option, so no fork and no patch.

## Consequences

- `deliverWebhook` replaces `fetch` on this one path. `deliverImpl` stays injectable for tests.
- The delivery carries a real DEADLINE, not node's `timeout` (which is socket inactivity and is reset
  by every byte — an endpoint dribbling one byte per 100 ms is never cut off). It also listens for
  errors on the RESPONSE: a peer that sends headers and then destroys the socket emits there, and
  `req.on('error')` never fires for it, so without that listener the promise never settles at all.
  The webhook worker runs several deliveries concurrently for the same reason: one sick endpoint
  must not be the whole queue's problem.
- HTTP/2 is not used for webhook delivery. Irrelevant: one POST per event to arbitrary endpoints.
- A host that legitimately round-robins across many public IPs is pinned to the one we validated for
  the duration of that request — which is exactly the intent.
