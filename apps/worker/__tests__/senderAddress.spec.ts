import { describe, expect, it } from 'vitest'

import { sendingAddress } from '../src/notify/senderAddress.js'

/**
 * Which address a tenant's mail leaves from (ADR-036, audit W-3).
 *
 * ── What this fake may and may not do ────────────────────────────────────────────────────────────
 * It hands back exactly the rows it is given and applies NO predicate of its own. An earlier version
 * filtered on `verifiedAt !== null` inside the fake, which made the headline test — "a pending
 * identity is not an address" — true by construction: delete the WHERE clause from the SQL and it
 * still passed. A fake that re-implements the thing under test is testing itself.
 *
 * So the row-selection rules are asserted against a REAL Postgres in the API suite, and what is left
 * here is the part that is genuinely this module's: the SQL it sends, the parameters it binds, and
 * how it behaves when the pool is unhappy.
 */
function poolOf(rows: { address: string }[], opts: { reject?: boolean } = {}) {
  const calls: { text: string; values: unknown[] }[] = []
  return {
    calls,
    pool: {
      query: (text: string, values: unknown[]) => {
        calls.push({ text, values })
        return opts.reject === true ? Promise.reject(new Error('pg down')) : Promise.resolve({ rows })
      },
    } as never,
  }
}

describe('sendingAddress', () => {
  it('returns whatever the verified-row query found', async () => {
    const { pool } = poolOf([{ address: 'alertai@klientas.lt' }])
    expect(await sendingAddress(pool, 't1')).toBe('alertai@klientas.lt')
  })

  it('no row ⇒ null, which sends on the platform identity', async () => {
    const { pool } = poolOf([])
    expect(await sendingAddress(pool, 't1')).toBeNull()
  })

  it('★ asks only for rows SES has verified, and joins the address in SQL', async () => {
    // `verifiedAt`, never `status`: they come apart on purpose. An identity whose last
    // GetEmailIdentity call came back unhappy is marked failed for the TENANT to see, while its DKIM
    // records are still published and still working — reverting that reseller to our From line on a
    // transient API answer would be the exact leak this feature closes. Whether the predicate picks
    // the right rows is asserted against a real Postgres in the API suite; this pins the clause.
    const { pool, calls } = poolOf([{ address: 'alertai@klientas.lt' }])
    await sendingAddress(pool, 't1')
    expect(calls[0]?.text).toContain('"verifiedAt" IS NOT NULL')
    expect(calls[0]?.text).not.toContain('status')
    expect(calls[0]?.text).toContain("mailbox || '@' || domain")
  })

  it('scopes to the tenant by parameter, never by interpolation', async () => {
    const { pool, calls } = poolOf([{ address: 'a@b.lt' }])
    await sendingAddress(pool, 't1')
    expect(calls[0]?.values).toEqual(['t1'])
    expect(calls[0]?.text).not.toContain('t1')
  })

  it('answers null for an empty tenant id without querying at all', async () => {
    const { pool, calls } = poolOf([{ address: 'a@b.lt' }])
    expect(await sendingAddress(pool, '')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('a query fault sends on the platform identity rather than failing the send', async () => {
    const { pool } = poolOf([], { reject: true })
    expect(await sendingAddress(pool, 't1')).toBeNull()
  })
})
