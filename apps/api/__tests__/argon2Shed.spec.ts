import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Argon2 saturation shedding (audit high, follow-up). Every hashing route — tenant login, password
 * change, password reset, self-serve signup, partner login — queues behind ONE process-wide
 * semaphore. The semaphore bounded MEMORY but the FIFO behind it was unbounded, so a flood on any
 * one of those routes made every legitimate login wait behind it: a slow, invisible authentication
 * outage with no error anyone could point at.
 *
 * The module reads its caps from env at import time, so this spec sets them BEFORE importing.
 */
process.env['ARGON2_MAX_CONCURRENT'] = '1'
process.env['ARGON2_MAX_WAITING'] = '1'
const { hashPassword, verifyPassword, argon2QueueDepth, Argon2OverloadedError, DUMMY_HASH_PROMISE } =
  await import('../src/auth/passwords.js')

// the module mints its timing-equalizer hash at import, which occupies the only slot here
beforeAll(async () => {
  await DUMMY_HASH_PROMISE
})

describe('argon2 queue shedding', () => {
  it('sheds past the queue cap instead of queueing forever', async () => {
    const inFlight = hashPassword('first-takes-the-only-slot')
    const queued = hashPassword('second-waits')
    await new Promise((r) => setImmediate(r))
    expect(argon2QueueDepth()).toBe(1) // the saturation signal the metric exposes

    // the third has nowhere to go — an honest, retryable error beats a request that resolves in
    // half a minute, and the caller maps it to 503 (app.ts onError), never to a 500
    await expect(hashPassword('third-is-shed')).rejects.toBeInstanceOf(Argon2OverloadedError)

    await Promise.all([inFlight, queued])
    expect(argon2QueueDepth()).toBe(0) // drains cleanly, no leaked waiters
    expect(await hashPassword('after-the-storm')).toMatch(/^\$argon2id\$/)
  }, 30_000)

  it('an overload NEVER reads as a wrong password', async () => {
    // verifyPassword swallows argon2 errors to mean "no match". If the shed were caught by that
    // same handler, an overload would answer "wrong password" — incrementing the lockout counter
    // and locking real users out of their accounts under load, from an unauthenticated flood.
    const stored = await hashPassword('correct horse battery staple')
    const hold = hashPassword('holds-the-slot')
    const queued = hashPassword('holds-the-queue')
    await new Promise((r) => setImmediate(r))
    await expect(verifyPassword(stored, 'correct horse battery staple')).rejects.toBeInstanceOf(Argon2OverloadedError)
    await Promise.all([hold, queued])
    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true)
    expect(await verifyPassword(stored, 'wrong')).toBe(false) // a real mismatch is still just false
  }, 30_000)
})
