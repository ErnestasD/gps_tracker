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

/**
 * Global concurrency cap on argon2 (review HIGH): each hash pins 64 MB. The
 * per-identity lockout throttles rate, NOT instantaneous concurrency — a burst
 * across many emails/IPs could otherwise run unbounded 64 MB ops and OOM the
 * process. This semaphore bounds total in-flight argon2 memory to
 * MAX_CONCURRENT×64 MB regardless of request shape; excess requests queue.
 */
const MAX_CONCURRENT = Number(process.env['ARGON2_MAX_CONCURRENT'] ?? 8)
/**
 * Cap on the WAITING queue, not just the running slots (audit high). The semaphore bounded memory
 * but the FIFO behind it was unbounded, so a flood on any hashing route grew an ever-longer queue
 * and every legitimate login waited behind it — a slow, invisible authentication outage.
 *
 * Sized as a LATENCY budget, not a memory one: `slots × (targetWait / hashTime)`. At the measured
 * ~115 ms/hash across 8 slots, 64 waiters ≈ 0.9 s of queueing before we shed. A memory-sized cap
 * (thousands) technically bounds the queue while still making every login take half a minute —
 * the outage survives, just with a 503 tail (review MED).
 */
const MAX_WAITING = Number(process.env['ARGON2_MAX_WAITING'] ?? 64)

/** Thrown when the argon2 queue is saturated; callers map it to 503, never to "wrong password". */
export class Argon2OverloadedError extends Error {
  constructor() {
    super('password hashing is saturated')
    this.name = 'Argon2OverloadedError'
  }
}

let active = 0
const waiters: (() => void)[] = []

/** Current queue depth — exported so the API can expose it as a metric (it is a saturation signal). */
export const argon2QueueDepth = (): number => waiters.length

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    if (waiters.length >= MAX_WAITING) throw new Argon2OverloadedError()
    await new Promise<void>((r) => waiters.push(r))
  }
  active++
  try {
    return await fn()
  } finally {
    active--
    waiters.shift()?.()
  }
}

export function hashPassword(password: string): Promise<string> {
  return withSlot(() => hash(password, OPTS))
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return withSlot(() => verify(passwordHash, password, OPTS).catch(() => false)) // malformed hash ⇒ no match
}

/** Precomputed hash of an unguessable value: unknown-email logins still run ONE
 * real argon2 verification so response timing does not reveal email existence. */
export const DUMMY_HASH_PROMISE: Promise<string> = hashPassword(
  'orbetra-timing-equalizer-not-a-real-password',
)
