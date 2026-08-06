-- Self-serve signup must not be an account-existence oracle (audit MED #67).
--
-- Answering a duplicate address with the same 201 as a real signup was necessary but not sufficient:
-- the FREE path still handed back a working account, so a second request — a login with the password
-- the caller had just chosen — answered the question with certainty. Proof of address ownership is
-- what removes that second request: an unverified account fails login exactly like a wrong password,
-- so both branches end in the same 401 and there is nothing to observe.
--
-- It is also, independently, the thing that stops a stranger from registering someone else's email.

-- DEFAULT now(), and it matters for one window only: between `migrate deploy` and the restart, the
-- OLD api is writing to the NEW schema. Every user it creates in those seconds would land NULL and
-- be locked out when the new code arrives, with no signal anywhere. Self-serve signup writes NULL
-- EXPLICITLY (Prisma sends the column), so the default cannot leak into the one path that must stay
-- unverified.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMPTZ DEFAULT now();

-- EVERY EXISTING USER IS VERIFIED. This column gates login, so a backfill that left anyone NULL
-- would lock a working tenant out of its own platform on deploy — the migration would be the outage.
-- `createdAt` rather than now() so the column reads as history rather than as "everyone verified the
-- day we shipped this".
UPDATE "users" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;

-- Mirrors password_reset_tokens: only the SHA-256 hash is stored, single-use via `usedAt`, expiring.
CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
  "id"        UUID        NOT NULL,
  "userId"    UUID        NOT NULL,
  "tokenHash" TEXT        NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "usedAt"    TIMESTAMPTZ,
  CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_verification_tokens_tokenHash_key" ON "email_verification_tokens" ("tokenHash");
CREATE INDEX IF NOT EXISTS "email_verification_tokens_userId_idx" ON "email_verification_tokens" ("userId");
ALTER TABLE "email_verification_tokens" DROP CONSTRAINT IF EXISTS "email_verification_tokens_userId_fkey";
ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
