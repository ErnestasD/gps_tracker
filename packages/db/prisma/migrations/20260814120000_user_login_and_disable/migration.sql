-- Two questions the platform console could not answer, because the columns did not exist.
--
-- `lastLoginAt`: "who actually uses this system?" A user row proves an account was created, not
-- that anyone came back. Without it, a seat that has never been used and a seat someone signs into
-- daily are the same row, and there is no way to see a customer quietly churning before they say so.
--
-- `disabledAt`: there was no way to stop a person logging in short of deleting them, which destroys
-- their audit attribution. A disabled user keeps their history and loses their access.
ALTER TABLE "users" ADD COLUMN "lastLoginAt" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "disabledAt" TIMESTAMPTZ;

-- The console's default view is "recently active users, newest first"; without this it is a
-- sequential scan of every user on the platform on every page load.
CREATE INDEX "users_lastLoginAt_idx" ON "users" ("lastLoginAt" DESC NULLS LAST);
