# ADR-041: Uploaded brand assets live in Postgres and are served from the tenant's own host

Status: accepted (2026-09-03)

## Context

White-label tenants had exactly one image field, "Logo URL", and it had to be a URL they hosted
themselves. Two problems followed from that.

**One field, two incompatible jobs.** `logoUrl` drove the sidebar, the sign-in page, the e-mail
header *and* the browser-tab icon (`apps/web/src/lib/branding.ts`, which said so outright: *"a
tenant's logo IS their favicon — no separate input"*). The customer-facing guide asked, in one
paragraph, for a wide ~200×50 wordmark and for a square mark that reads at 16px
(`docs/guides/white-label-setup.md:82,87`). No file is both, so every reseller was silently losing
one of them. The web manifest inherited the same problem and could only ever declare
`sizes: 'any'` — a guess Chrome will not accept as install-worthy, so a tenant's PWA was not
installable.

**"Host it somewhere permanent" is a real barrier.** Most resellers do not have anywhere to put a
file. The feature they had paid for was gated behind an unrelated piece of infrastructure.

The obvious fix — accept an upload — immediately raises the question this ADR exists to answer:
where do the bytes live, given that a reseller's customer must never see our domain?

## Decision

### 1. NOT object storage (Cloudflare R2, S3, or any bucket)

R2 was the assumed answer and it cannot satisfy the constraint. Every bucket must be reachable at
some hostname, and the only hostnames we can offer are `pub-<id>.r2.dev` or something like
`assets.orbetra.com`. Both appear in the customer's browser (`<img src>`, the favicon `<link>`) and
in every branded e-mail. Giving each tenant a bucket domain of *their* own would require their DNS
to live in our Cloudflare account, which a customer's domain cannot.

So the storage choice is not a cost or scale question here. Any external bucket **reintroduces the
exact leak the white-label feature exists to prevent.**

### 2. The bytes live in Postgres (`tenant_assets`, `BYTEA`)

Sized for what this actually is: at most two rows per tenant (`PRIMARY KEY (tenantId, slot)`), each
capped at 512 KB. A favicon is single-digit KB. The count cap is structural rather than enforced —
there is no counting query to get wrong — and the count × size product is bounded at 1 MB per tenant,
which is the shape `packages/db/src/repos/geofences.ts:26-35` argues for.

Consequences we accept: blobs in the row store, and backup size grows with tenants. Consequences we
gain: no new runtime dependency (this would have been the repo's first AWS SDK), no new credentials,
no egress bill, no second backup path — the images are already covered by the WAL archive — and no
new failure mode between the API and an external service on a page-load path.

The filesystem was rejected as well: `ExportJob.path` writes to a container-local disk, which is fine
for a 24-hour export and wrong for a logo that must survive a redeploy.

### 3. Served by the API, from whatever host asked

`GET /v1/public/brand/<sha256[0:32]>.<png|svg>`. Caddy already proxies `/v1/*` on tenant custom
domains and on `<slug>.orbetra.com` (`infra/caddy/Caddyfile:216`), so **no edge configuration
changed** — the same property `/v1/public/manifest.webmanifest` already relies on.

Branding therefore stores a **relative path**, and that is the crux of the design: it resolves
against whatever host the page is on, so one stored string is correct on the reseller's own domain,
on their platform subdomain, and in our dashboard, with nobody computing a per-tenant origin.

Resolution is **by content hash alone, with no tenant lookup**. A Host-keyed route could not serve
our own dashboard, where a reseller admin edits their brand. Serving a public logo to whoever asks
costs nothing — it is already on their unauthenticated sign-in page — provided the response can never
be active content, which §5 guarantees.

Because the URL is a content address, the response is `public, max-age=31536000, immutable` and
carries **no `Vary`** — unlike `/v1/branding` and the manifest, this body depends on the path only.
A replaced image gets a new URL, so a stale copy cannot exist.

The extension is part of the **lookup**, not a check performed after it: `byHash(prefix, mime)`. The
same bytes can legitimately be stored under both mimes (a file can satisfy the PNG header check and
also contain `<svg`), and selecting an arbitrary row and then rejecting it on type turned a perfectly
valid brand URL into an intermittent 404.

A **miss is `no-store`**, though. A 404 here is not permanent: deleting an image and re-uploading the
same file reproduces the same digest, so a cached negative would hide the restored logo for as long
as it was held. Only a hit opts into the long life.

The throttle **fails open** (as `caddy-ask` does): a Redis blip must not blank the logo on every
white-label sign-in page at once. The exposure that buys is small because the response is immutable
and browser-cached for a year, so steady-state traffic is one fetch per client per image change. If
that ever stops being true, the fix is an in-process LRU in front of `byHash` — trivially correct
because the content is addressed by its own hash — not a stricter limiter.

### 3a. The branding merge takes a row lock

`put`/`remove` merge one key into the `branding` jsonb, which is a read-modify-write. A transaction
makes that **atomic but not isolated**: at READ COMMITTED a plain `SELECT` takes no lock, so two
concurrent uploads both read the pre-merge object and the second write drops the first one's key —
leaving both files stored and only one referenced. The settings page makes this reachable, since a
tenant can pick a logo and a favicon a second apart and the two requests are independent. Both
transactions therefore take `SELECT … FOR UPDATE` on the tenant row **first**, before touching
`tenant_assets`, so the lock order is consistent.

### 4. Uploads are base64 in a JSON body, not multipart

The repo parses no multipart anywhere, and `deviceImportSchema` (a 2 MB CSV as a JSON string) is the
standing precedent. Accepting a 20 KB favicon was not worth a body-parsing dependency and a second
request-handling path. The 1 MB global body cap already covers a 512 KB file base64-encoded, so
`pickBodyLimit` needed no new branch either.

### 5. SVG is accepted, and the `sandbox` CSP — not markup screening — is what makes it safe

An SVG is a document: opened directly it executes script in the origin serving it, which on a tenant
host is the origin holding their session. The response therefore carries
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`. A sandbox without
`allow-scripts` blocks execution outright, including on direct navigation, and this is the control we
rely on. There is no global CSP on the API (`apps/api/src/security.ts`), so nothing is overridden.

`validateSvg` (`packages/shared/src/brandAsset.ts`) additionally rejects `<script>`, `on*=` handlers,
`javascript:`, `<foreignObject>`, embedded documents, internal DTD subsets and remote references.
This is **defence in depth and is documented as fallible** — regex screening of markup can be
defeated. It exists so an obviously hostile upload is refused with a message rather than stored
forever and silently neutered, and so that a future route which forgets the header is not a total
loss.

The declared mime is never trusted: `inspectBrandAsset` re-derives the type from the bytes (PNG magic
+ IHDR, or an `<svg` root), and that derived value is what gets stored and later served.

### 6. One deliberate exception to a global security header

`Cross-Origin-Resource-Policy: same-origin` is applied to every API response, after the handler, so a
route cannot loosen it for itself. Brand images are fetched cross-origin by design — the sign-in page,
our dashboard, a mail client — so `securityHeaders` carries a single path-prefix exception for
`/v1/public/brand/`, pinned by `apps/api/__tests__/securityHeaders.spec.ts`.

### 7. E-mail is the one consumer that cannot resolve a relative path

A mail client has no page to resolve against, so `absolutizeBrandAssets` stamps the tenant's own
origin on the value where branding is READ for a message. That origin is the tenant's oldest verified
domain — the rule `onTenantHost` already used for auth links, lifted into
`apps/worker/src/notify/tenantOrigin.ts` so both share one definition. A tenant with no verified
domain falls back to `APP_BASE_URL`, which is not a new leak: their auth links already land there,
because there is nowhere else for them to go. With no origin at all the logo is simply omitted and
the header renders the product name as text — a missing logo, never a broken one.

## Consequences

- Adding a favicon field required **no migration for branding itself** — it is jsonb. The new table is
  for the bytes only.
- `brandingSchema.logoUrl`/`faviconUrl` now accept an https URL **or** a `/v1/public/brand/…` path.
  Both are rendered as `<img src>` / `<link href>`, never innerHTML; the https pin still applies to
  the external form.
- Every branding key must appear in `clean()` (`apps/web/src/lib/branding.ts`): `PATCH
  /v1/tenant/branding` replaces the whole jsonb, so an omitted key is deleted on the next save. The
  upload response returns the full merged branding for exactly this reason, the page reseats both its
  form and its saved baseline from it, and Save is disabled while an upload is in flight — a PATCH
  racing an upload would delete the image just stored, and report success. A test derives the
  expected key set from `brandingSchema` so a new field cannot be added without landing in `clean()`.
- `faviconUrl` falls back to `logoUrl` through `iconFor()`, which treats `''` as unset. The form holds
  a cleared field as an empty string, so `??` alone would have blanked the tab icon in the live
  preview while the field preview and the saved result both fell back.
- The manifest can finally declare a real `sizes`/`type` for an uploaded PNG, which is what makes a
  white-label PWA installable.
- **If this ever outgrows Postgres**, the serving route is a stable facade: the byte source can move
  to R2 behind it without a single customer-visible URL changing. That migration is deliberately not
  taken now, because it would buy nothing and cost the constraint in §1 unless it is proxied anyway.

## Not done here

Server-side image resizing or optimisation (would need `sharp` — a new dependency and its own ADR),
ICO generation, asset version history, and asset slots for other purposes. ADR-025 leaves the PDF
report logo as a follow-up; after this it has something to use.
