-- The partner's own language for the mail we send them.
--
-- Partner notifications were rendered in four languages and enqueued with a hardcoded 'en', so three
-- of the four translations were unreachable. A partner is not a tenant user — there is no user row
-- carrying a locale — and the referred customer's browser language is the wrong person's preference,
-- so the language belongs on the affiliate row and is set by an admin when they invite them.
ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'en';
