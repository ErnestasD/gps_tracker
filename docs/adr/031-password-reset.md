# ADR-031: Self-service password reset (forgot-password)

Status: accepted (founder decision, 2026-07-20)

## Context

V1 shipped with no forgot-password flow — the login page told users "password reset is handled by
your administrator". The founder decided self-service reset is now required. Password reset is a
classic attack surface (token leakage, email enumeration, replay, host-header injection into the
reset link), so the design mirrors the already-reviewed refresh-token discipline rather than
inventing a new token model.

## Decision

1. **Token model** = the refresh-token model, minus rotation. Raw token = 32 B CSPRNG; only its
   `sha256` is stored (`password_reset_tokens.tokenHash`, unique). 256-bit entropy makes offline
   brute force moot (same rationale as `RefreshToken.tokenHash` / `ApiKey.hash`). **Single-use**
   (`usedAt`, atomic conditional UPDATE — exactly one concurrent consume wins) and **short-lived**
   (`expiresAt`, 1 h). Requesting a new reset invalidates the user's outstanding tokens.

2. **UNSCOPED exemption.** `passwordResetTokens.*` is added to `UNSCOPED_AUTH_METHODS`
   (`packages/db/src/auth.ts`). Rationale is identical to `refreshTokens.*`: the flow *precedes* any
   session/tenant knowledge, and rows hang off `userId`, addressed only by `tokenHash`. The
   tenant-isolation meta-test (`tests/isolation/prisma.spec.ts`) is updated in lock-step — this ADR
   is the review the "no silent growth" guard demands.

3. **No email enumeration.** `POST /v1/auth/forgot-password` always returns 200 with the same body
   whether or not the email exists, and burns an equivalent amount of work on the miss path (mirrors
   login's dummy-verify timing defense).

4. **Rate limiting.** Per-IP + per-email fixed-window counter (reuses login's atomic Lua `INCR`+
   `EXPIRE` script) on the forgot endpoint, so the send path can't be used to spam a mailbox or
   probe for accounts.

5. **Reset invalidates all sessions.** A successful reset sets the new argon2 hash, then revokes
   ALL of the user's refresh families and calls `markSessionsRevoked` (tears down live WS sockets) —
   a reset must log out every other session (parity with the self-service password change, and it
   also closes audit finding R2-5 for the deletion/logout paths, wired at the same time).

6. **Reset link base = `APP_BASE_URL`.** The email link is built from the trusted, server-configured
   `APP_BASE_URL` env, never from a request `Host`/`Origin` header — this removes host-header
   injection into the link entirely. Per-tenant white-label reset domains are a follow-up (would key
   off a verified `tenant_domains` row).

7. **Delivery.** The API cannot send email (SES/SMTP transport lives in the worker). The API enqueues
   a BullMQ `auth-email` job; the worker renders the tenant-branded email (`renderBrandedEmail`,
   same path as scheduled reports) and sends it via the existing `emailTransport`. If the transport
   is not configured the job is a no-op (channel skipped) — same env-gating as every other driver.

## Consequences

- New table `password_reset_tokens` (append-only migration `20260720120000_password_reset_tokens`).
- New public routes `POST /v1/auth/forgot-password` and `POST /v1/auth/reset-password` (registered
  before the `/v1/*` auth guard, like login).
- New worker queue `auth-email` + worker + branded reset-email template.
- The reset link requires `APP_BASE_URL` to be set in the API env for the email to carry a working
  link; unset ⇒ the job logs and skips (documented in the README env table).
