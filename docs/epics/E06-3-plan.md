# E06-3 Plan — Public REST + API keys + per-key rate limit

> W6 S3. PROJECT_PLAN §6.6. Autonominė sesija.

## Context

Web naudoja Bearer JWT. Integracijoms reikia API raktų (`X-Api-Key`) TŲ PAČIŲ /v1 route'ų. ApiKey Prisma modelis jau yra (prefix, hash SHA-256 @unique, scopes, revokedAt). §6.6: `Authorization: Bearer <jwt> (web) | X-Api-Key (integrations)`. §8 rate limit per-key token bucket 600/min. W6 exit: „external script pulls yesterday's trips via API key".

## Sprendimai

- **Repo `packages/db/src/repos/apiKeys.ts`** (scoped, nullable account): create (generate `orb_live_<48hex>`, store SHA-256 hash + prefix, grąžina plaintext VIENĄ kartą), list (view be hash), revoke (scoped, sets revokedAt), **findActiveByHash** (UNSCOPED auth lookup → {id,tenantId,accountId,scopes}), touch (lastUsedAt best-effort). hashKey exported. createDb + Db + index.
- **Auth `apps/api/src/auth/apiKey.ts`** `createApiKeyAuth({apiKeys,redis,perMin,now?})`.resolve(rawKey): sha256→findActiveByHash; null→unauthorized; rate limit fixed 60s window (`apikey:rl:{id}:{minuteBucket}` INCR+EXPIRE, >perMin→rate_limited); touch fire-forget; grąžina AuthContext {userId:keyId, tenantId, accountId? (null→omit=tenant-wide), role:'viewer'}. **viewer = READ-only** (READ_POLICY [...ROLES] apima, WRITE_POLICY ne → writes 403).
- **Middleware** `authMiddleware({jwtSecret, apiKey?})` — jei `X-Api-Key` header IR apiKey deps → resolve (429 rate/401 unknown); kitaip esamas JWT path (web nepakitęs). Bandomas X-Api-Key TIK jei header yra.
- **Routes `apps/api/src/routes/apiKeys.ts`** `mountApiKeys` — POST/GET/DELETE /v1/api-keys **TENANT-ADMIN gated** (API raktas=viewer → 403, jokios privilege escalation). Dedikuoti route'ai (create grąžina plaintext=non-standard shape), EXEMPT manifeste + dedikuoti isolation testai. app.ts createApiKeyAuth + authMiddleware apiKey + mountApiKeys; ApiDeps.apiKeyRateLimitPerMin?=600.
- **shared:** apiKeyCreateSchema {name, accountId?nullable, scopes?['read']}.

## Failai

**Nauji:** packages/db/src/repos/apiKeys.ts; apps/api/src/auth/apiKey.ts; apps/api/src/routes/apiKeys.ts; apps/api/__tests__/{apiKeyAuth.spec.ts, apiKeys.spec.ts}; docs/epics/E06-3-plan.md.
**Keičiami:** packages/db/src/{db.ts,index.ts}; apps/api/src/{app.ts, auth/middleware.ts}; apps/api/__tests__/helpers/auth.ts (fakeDb +apiKeys); packages/shared/src/entities.ts; tests/isolation/suite.spec.ts (EXEMPT api-keys ×2); README.

## Testai (12)

- **apiKeyAuth.spec (5)** — resolve active→viewer ctx; account-null→omit accountId; unknown/revoked→unauthorized; rate limit 601>600→rate_limited; EXPIRE 60 first-of-window.
- **apiKeys.spec (7, pg+redis)** — admin mint→201 orb_live_ plaintext; key auth READ /v1/devices→200; key READ-ONLY write→403 + mint→403 (no escalation); unknown key→401 + revoked→401; isolation K2 negali revoke K1 (404) + K1 keys nematomi K2; per-key rate limit (RATE+1→429); non-admin JWT mint→403.

## Verifikacija (DoD)

Gates + 12 testų žali. §10 #7 (tenant leak): findActiveByHash grąžina rakto scope (ne guess), management scoped+isolation; #10 (WS auth) n/a. Plaintext NIEKADA nesaugomas/loginamas (tik hash+prefix). Rate limit Redis (noeviction). Public API = esami route'ai per X-Api-Key (jokių naujų endpoint'ų).

## Rizikos

- **Privilege escalation**: API raktas=viewer, management=tenant-admin → raktas negali mint/write. Test'ai gaudo.
- **Plaintext leak**: hash+prefix only; audit saugo view. touch best-effort (ne blokuoja).
- **Rate limit token-bucket approx**: fixed 60s window (kaip lockout/caddyAsk); burst ties riba priimtina 600/min. Note.
- **Web API-keys UI** = follow-up (management per API veikia; UI vėliau). E06-4 webhooks HMAC delivery next.
