-- The house-account test asks "does this email domain already have accounts?" on every deal
-- registration and on every admin queue load. `users` had only a plain btree on `email`, which a
-- `split_part(lower(email), '@', 2) = $1` predicate cannot use — so each check sequentially scanned
-- the user table. A functional index is the only kind that serves it.
--
-- Not CONCURRENTLY: prisma migrate runs each file in a transaction, and CREATE INDEX CONCURRENTLY
-- cannot run inside one. The table is small enough that the brief lock is not worth splitting the
-- migration in two.
CREATE INDEX IF NOT EXISTS "users_email_domain_idx" ON "users" ((split_part(lower("email"), '@', 2)));
