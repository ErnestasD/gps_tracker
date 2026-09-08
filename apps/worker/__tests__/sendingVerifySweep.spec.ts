import { describe, expect, it, vi } from 'vitest'

import { runSendingVerify } from '../src/jobs/sendingVerifyWorker.js'

/**
 * Finishing a sending-domain verification when nobody is watching (ADR-036).
 *
 * The settings panel polls and advances itself, and that was the ONLY thing that did. A reseller who
 * published their DKIM records and closed the tab had nothing completing the job: SES verified the
 * identity an hour later, the row stayed `pending`, and their mail kept going out as the platform —
 * indefinitely, and silently, because that state is indistinguishable from the normal wait. Observed
 * on the founder's own domain: AWS mailed `AWS_SES_DKIM_PENDING_TO_VERIFIED` for dokigo.lt while the
 * row still read `pending`.
 */
function poolOf(rows: { tenantId: string; domain: string }[]) {
  const writes: { sql: string; values: unknown[] }[] = []
  return {
    writes,
    pool: {
      query: (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT')) return Promise.resolve({ rows })
        writes.push({ sql, values: values ?? [] })
        return Promise.resolve({ rows: [] })
      },
    } as never,
  }
}

describe('runSendingVerify', () => {
  it('★ flips a row SES has verified, without anybody having the panel open', async () => {
    const { pool, writes } = poolOf([{ tenantId: 't1', domain: 'klientas.lt' }])
    const r = await runSendingVerify({ connection: {}, pool, readIdentity: () => Promise.resolve('verified') })
    expect(r).toMatchObject({ pending: 1, verified: 1, failed: 0, unreachable: 0 })
    expect(writes[0]?.sql).toContain("status = 'verified'")
    // …and only while it is still unverified, so a panel that won the race keeps the first time
    expect(writes[0]?.sql).toContain('"verifiedAt" IS NULL')
  })

  it('leaves a still-pending identity exactly as it was', async () => {
    const { pool, writes } = poolOf([{ tenantId: 't1', domain: 'klientas.lt' }])
    const r = await runSendingVerify({ connection: {}, pool, readIdentity: () => Promise.resolve('pending') })
    expect(r).toMatchObject({ pending: 1, verified: 0 })
    expect(writes).toHaveLength(0)
  })

  it('records a FAILED identity so the tenant can see it — nothing was flowing yet', async () => {
    const { pool, writes } = poolOf([{ tenantId: 't1', domain: 'klientas.lt' }])
    const r = await runSendingVerify({ connection: {}, pool, readIdentity: () => Promise.resolve('failed') })
    expect(r.failed).toBe(1)
    expect(writes[0]?.sql).toContain("status = 'failed'")
  })

  it('★ an AWS fault is unreachable, never a change to the row', async () => {
    // the worst case must be a tenant waiting one more interval, never a sender taken away
    const { pool, writes } = poolOf([{ tenantId: 't1', domain: 'klientas.lt' }])
    const r = await runSendingVerify({
      connection: {}, pool,
      readIdentity: () => Promise.reject(new Error('AccessDenied')),
    })
    expect(r).toMatchObject({ pending: 1, verified: 0, unreachable: 1 })
    expect(writes).toHaveLength(0)
  })

  it('★ only ever selects rows that are NOT yet verified', async () => {
    // `verifiedAt` is set once and never cleared here. A verified identity whose GetEmailIdentity
    // comes back unhappy keeps sending: its DKIM records are still published, and reverting that
    // reseller to OUR From line on one bad call is the exact leak this feature closes.
    const seen: string[] = []
    const pool = {
      query: (sql: string) => {
        seen.push(sql)
        return Promise.resolve({ rows: [] })
      },
    } as never
    await runSendingVerify({ connection: {}, pool, readIdentity: () => Promise.resolve('verified') })
    expect(seen[0]).toContain('"verifiedAt" IS NULL')
  })

  it('without credentials it counts and does nothing — the routes 503 for the same reason', async () => {
    const { pool, writes } = poolOf([{ tenantId: 't1', domain: 'klientas.lt' }])
    const read = vi.fn()
    const r = await runSendingVerify({ connection: {}, pool })
    expect(r).toMatchObject({ pending: 1, verified: 0 })
    expect(read).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })

  it('one bad domain does not stop the others', async () => {
    const { pool } = poolOf([
      { tenantId: 't1', domain: 'a.lt' },
      { tenantId: 't2', domain: 'b.lt' },
      { tenantId: 't3', domain: 'c.lt' },
    ])
    const r = await runSendingVerify({
      connection: {}, pool,
      readIdentity: (d) => (d === 'b.lt' ? Promise.reject(new Error('boom')) : Promise.resolve('verified')),
    })
    expect(r).toMatchObject({ pending: 3, verified: 2, unreachable: 1 })
  })
})
