import { hash, verify } from '@node-rs/argon2'

import { ARGON2ID_PARAMS } from '@orbetra/shared'

/**
 * Password hashing seam (E03-1): argon2id with the story-mandated params
 * (m=64MB, t=3, p=4), single-sourced from @orbetra/shared so the seed script
 * cannot drift. AC[3] asserts the PHC string; the login timing test spies on
 * verifyPassword through this module boundary.
 */

// algorithm: 2 = Algorithm.Argon2id (@node-rs/argon2 const enum is unusable
// under isolatedModules); the PHC prefix test pins the algorithm anyway
const OPTS = { algorithm: 2, ...ARGON2ID_PARAMS }

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS)
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password, OPTS).catch(() => false) // malformed hash ⇒ no match
}

/** Precomputed hash of an unguessable value: unknown-email logins still run ONE
 * real argon2 verification so response timing does not reveal email existence. */
export const DUMMY_HASH_PROMISE: Promise<string> = hashPassword(
  'orbetra-timing-equalizer-not-a-real-password',
)
