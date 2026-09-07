import { describe, expect, it } from 'vitest'

import { sendingAddress } from '../src/notify/senderAddress.js'

/**
 * Which address a tenant's mail leaves from (ADR-036, audit W-3).
 *
 * A fake pool that records the SQL and answers from a fixed row set. The WHERE clause is the thing
 * under test, so the fake must apply it rather than hand back whatever it holds — these assertions
 * are about which rows qualify, not about what Postgres would do with them.
 */
function poolOf(rows: { domain: string; mailbox: string; status: string; verifiedAt: Date | null }[]) {
  const calls: { text: string; values: unknown[] }[] = []
  return {
    calls,
    pool: {
      query: (text: string, values: unknown[]) => {
        calls.push({ text, values })
        const hit = rows.filter((r) => r.verifiedAt !== null)[0]
        return Promise.resolve({ rows: hit === undefined ? [] : [{ address: `${hit.mailbox}@${hit.domain}` }] })
      },
    } as never,
  }
}

const verified = { domain: 'klientas.lt', mailbox: 'alertai', status: 'verified', verifiedAt: new Date('2026-09-01T00:00:00Z') }

describe('sendingAddress', () => {
  it('gives the tenant their own address once SES has verified it', async () => {
    const { pool } = poolOf([verified])
    expect(await sendingAddress(pool, 't1')).toBe('alertai@klientas.lt')
  })

  it('a tenant with no sending domain sends on the platform identity', async () => {
    const { pool } = poolOf([])
    expect(await sendingAddress(pool, 't1')).toBeNull()
  })

  it('★ a PENDING identity is not an address — the domain has not signed for us yet', async () => {
    // Sending as a domain whose DKIM records are not published fails DMARC and lands a customer's
    // alerts in spam. Unverified must never become unsent: null here means "use ours", which is a
    // smaller problem than a vehicle-theft alert nobody receives.
    const { pool } = poolOf([{ ...verified, status: 'pending', verifiedAt: null }])
    expect(await sendingAddress(pool, 't1')).toBeNull()
  })

  it('★ but a FAILED status with a verification date still sends — the records are still published', async () => {
    // `status` is what the settings screen shows the tenant; `verifiedAt` is whether SES actually
    // authorised us. They come apart on purpose: one unhappy GetEmailIdentity call must not silently
    // revert a reseller to OUR From line, which is the exact leak this feature exists to close.
    const { pool, calls } = poolOf([{ ...verified, status: 'failed' }])
    expect(await sendingAddress(pool, 't1')).toBe('alertai@klientas.lt')
    expect(calls[0]?.text).toContain('"verifiedAt" IS NOT NULL')
    expect(calls[0]?.text).not.toContain('status')
  })

  it('scopes to the tenant by parameter, never by interpolation', async () => {
    const { pool, calls } = poolOf([verified])
    await sendingAddress(pool, 't1')
    expect(calls[0]?.values).toEqual(['t1'])
    expect(calls[0]?.text).not.toContain('t1')
  })

  it('answers null for an empty tenant id without querying at all', async () => {
    const { pool, calls } = poolOf([verified])
    expect(await sendingAddress(pool, '')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('a query fault sends on the platform identity rather than failing the send', async () => {
    const pool = { query: () => Promise.reject(new Error('pg down')) } as never
    expect(await sendingAddress(pool, 't1')).toBeNull()
  })
})
