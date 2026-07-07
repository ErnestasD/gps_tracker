# ADR-019: E03-1 auth dependencies & token design decisions

**Date:** 2026-07-07 · **Status:** accepted · **Story:** E03-1 (CLAUDE.md rule 10 gate)

## New dependencies

- **@node-rs/argon2** (runtime apps/api; devDep packages/db for the seed script) —
  argon2id per story params (m=64MB, t=3, p=4). Chosen over the `argon2` npm package
  because it ships prebuilt napi binaries via platform optionalDependencies — **no
  postinstall build script**, so the root `pnpm.onlyBuiltDependencies` gate stays
  `['esbuild']`. Covers darwin-arm64 dev + linux-x64 CI/prod. PHC string output makes
  the AC[3] anti-weakening test a regex.
- **zod** (apps/api) — same version as packages/shared; validates JWT claim shape and
  request bodies. Already the repo's schema layer via shared, now a direct dep.
- **@orbetra/db** (workspace → apps/api) — the api's FIRST DB dependency:
  `createAuthDb` (users + refresh tokens). `DATABASE_URL` becomes required for the api.
- **NOT added:** jose (hono/jwt built-in covers HS256 sign/verify + exp checks; we
  add zod claim-shape validation and an `iss` check on top), cookie libs (hono/cookie
  built-in), bcrypt.

## Design decisions recorded

- **Refresh tokens are opaque 32-byte CSPRNG values, sha256-stored** (not argon2:
  256-bit entropy makes offline brute force moot; the lookup needs a deterministic,
  cheap hash — precedent: ApiKey.hash). Rotating families; reuse of a consumed token
  revokes the family (AC[1]).
- **Strict family revocation**: two concurrent refreshes with the same cookie → one
  wins, the loser's attempt reads as reuse and kills the family. The web client's
  single-flight refresh makes this rare. A reuse **grace window** (accepting the
  immediately-previous token for a few seconds) is the documented V2 fix if
  multi-tab churn hurts in practice.
- **Sliding refresh expiry** (each rotation gets +REFRESH_TTL): a family lives as
  long as it is used. An absolute family cap is not required by the spec; revisit
  with the security story (IMPLEMENTATION_PLAN line 337).
- **HS256, no aud, no clock leeway**: signer and verifier are the same process in
  v1. Revisit if token verification ever moves off-host.
- **Cookie `orb_refresh`: HttpOnly, SameSite=Strict, Path=/v1/auth** — never rides
  on data requests. Same-origin deployment is mandated in v1 (split-origin would
  need SameSite=None + CORS-with-credentials — unsupported, noted in README).
- **Login without tenant context** (until E03-5 host-based resolution): verify
  against ALL email matches across tenants, no short-circuit; unknown email burns a
  dummy argon2 verify (timing equalization); >1 verified ⇒ 409 ambiguous-identity
  (founder decision 2026-07-07).
- **Lockout** (§6.1): Redis counter per (IP, sha256(email)[:16]), checked BEFORE any
  argon2 work; 5 fails → 429 with Retry-After for the remaining window; success
  resets. XFF honored only with TRUST_PROXY=1.
