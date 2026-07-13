# V1-nice Plan — temporary public share links

> Not in PROJECT_PLAN §4 V1-MUST; V1-nice per the founder's autonomous mandate (2026-07-13:
> "autonomiskai tesk kodinima visko kas tik imanoma… v2, v3 ir dar daugiau"). A tenant user
> mints an EXPIRING, REVOCABLE public URL that shows ONE device's live position on a map with
> no login — the standard TSP "share your courier's ETA" feature.

## AC (self-imposed, testable)
1. A tenant user creates a share for a device → gets an opaque URL; the plaintext token is
   shown ONCE (hashed at rest, like API keys E06-3). List + revoke their shares.
2. The public endpoint returns ONLY that one device's latest position + label, and returns
   410/expired once `expiresAt` passes or the link is revoked — enforced in SQL, not JS.
3. No tenant scope leak: creation/list/revoke are manifest-scoped (isolation suite auto-covers
   cross-tenant 404); the public resolve leaks nothing but the shared device.
4. Public endpoint is rate-limited per token and `Cache-Control: no-store`.

## Security model (the whole point)
- **Token** = 32 random bytes hex (`randomBytes(32)`), unguessable; stored as SHA-256 hash +
  short display prefix. Plaintext returned once. DB read never exposes a live link.
- **Resolve** (`resolveByHash`) is the ONE unscoped lookup (like `apiKeys.findActiveByHash`):
  `WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now()`. Expiry/revoke enforced
  in the query — a stale hash never resolves.
- Public position read is scoped to the RESOLVED (tenantId, deviceId) — never a client param.
- Rule 6: invalid-fix (`fix_valid=false`) positions are excluded from the shared point (we show
  last VALID location, consistent with map trails).
- Rate-limit per token hash (Redis fixed window), `no-store`.

## Data (Prisma migration — append-only)
`model ShareLink`: id(uuid) · tenantId(uuid) · deviceId(bigint) · tokenHash(unique) ·
tokenPrefix · label? · createdByUserId(uuid) · expiresAt(timestamptz) · revokedAt?(timestamptz) ·
createdAt. FK device→onDelete Cascade (retiring/erasing a device kills its links). Index (tenantId),
(deviceId). Unique(tokenHash).

## Repo `packages/db/src/repos/shareLinks.ts` (scoped)
- `list(scope, deviceId?)` → views (tenant/account scoped; device filter optional).
- `create(scope, actor, {deviceId, ttlHours, label?})` → `{ token, view }`; caller pre-checks the
  device is in scope (`db.devices.get`) — repo pins tenantId/accountId from scope.
- `revoke(scope, actor, id)` → bool (scoped update).
- `resolveByHash(hash)` → `{ tenantId, deviceId } | null` — UNSCOPED, expiry/revoke in SQL.

## Shared schemas (`packages/shared`)
`shareCreateSchema { ttlHours: int 1..720 (30 d cap), label?: str ≤80 }`; `ShareLinkView`;
`PublicShareView { deviceLabel, expiresAt, position: { lat, lon, fixTime, speedKph?, course? } | null }`.

## API
- Manifest (scoped) — auto in isolation suite:
  - `POST /v1/devices/:id/shares` (entity device, scopeClass account) → `{ url, view }`.
  - `GET /v1/devices/:id/shares` (list for that device).
  - `GET /v1/shares` + `DELETE /v1/shares/:id` (entity `share`, scopeClass account) — manage.
- Public (registered BEFORE authMiddleware, manifest-EXEMPT), in `caddyAsk.ts`'s public block:
  - `GET /v1/public/share/:token` → resolve → latest VALID position (raw-SQL, scoped to resolved
    device) + device label → `PublicShareView`; 404 unknown/expired/revoked; rate-limited; no-store.

## Web
- Devices row → "Share" (data-testid `share-${imei}`) → `ShareCard`: TTL select (1h/8h/24h/7d),
  optional label, create → shows URL + copy; lists active shares with revoke + expiry countdown.
- Public page `/s/:token` (OUTSIDE app shell, no auth) → MapLibre map, marker at the device, polls
  `/v1/public/share/:token` ~15 s, shows label + last-seen + expiry; OSM attribution (rule 13);
  friendly "link expired" on 404. Pure helpers unit-tested.

## Tests
- **db** shareLinks.spec: create→list→resolve; resolveByHash returns null when expired / revoked /
  unknown; scoping (other tenant's link id → revoke false); token hashed (prefix ≠ full).
- **api** shares.spec: POST returns url+prefix; GET lists; DELETE revokes; cross-tenant device 404;
  public GET resolves to latest VALID position (invalid-fix row excluded), 404 after expiry/revoke,
  429 on rate-limit, no-store header.
- **isolation**: shares routes auto (manifest); public EXEMPT.
- **web**: expiry-countdown + share-url pure helpers; e2e smoke create→copy→revoke.

## Steps
1. Plan (this). 2. migration + prisma → db repo + resolveByHash → gates + shareLinks.spec.
3. shared schemas. 4. api routes (manifest + public) + register + shares.spec + isolation EXEMPT.
5. web ShareCard + public /s/:token page + router + i18n×4 → gates + e2e.
6. Adversarial review (focus: token guessability, expiry/revoke bypass, tenant leak on public
   resolve, invalid-fix leak, rate-limit bypass, no-store) → fixes → PR → CI → merge → memory.

## DoD
Gates + isolation + e2e green; shareLinks.spec proves expiry/revoke in SQL; public resolve leaks
only the shared device; §10 #7 (tenant leak) covered; token never stored plaintext.
