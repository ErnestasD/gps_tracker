import { describe, expect, it } from 'vitest'

import { brandAssetOrigin, primaryDomain } from '../src/notify/tenantOrigin.js'

/**
 * Which host a tenant's mail names (audit W-5, W-6).
 *
 * A fake pool that records the SQL and answers from a fixed row set, ordered the way Postgres would.
 * The ordering is the thing under test, so the fake must not do it for us — it replays the rows in
 * the order the query asked for, which is what the assertions read.
 */
function poolOf(rows: { domain: string; createdAt: number; verified?: boolean }[]) {
  const calls: { text: string; values: unknown[] }[] = []
  return {
    calls,
    pool: {
      query: (text: string, values: unknown[]) => {
        calls.push({ text, values })
        const platform = typeof values[1] === 'string' ? values[1] : ''
        const ranked = rows
          .filter((r) => r.verified !== false)
          .map((r) => ({ ...r, isPlatform: platform !== '' && r.domain.endsWith(`.${platform}`) }))
          .sort((a, b) => Number(a.isPlatform) - Number(b.isPlatform) || a.createdAt - b.createdAt)
        return Promise.resolve({ rows: ranked.slice(0, 1).map((r) => ({ domain: r.domain })) })
      },
    } as never,
  }
}

describe('primaryDomain prefers the tenant OWN domain over our subdomain', () => {
  // The order the setup guide teaches: take the instant subdomain now, do DNS later. The subdomain
  // row is created ALREADY VERIFIED, so it is always the oldest — under the old oldest-wins rule the
  // tenant's real domain could never win, permanently, because createdAt never changes.
  const asOnboarded = [
    { domain: 'reseller.orbetra.com', createdAt: 1 },
    { domain: 'track.reseller.lt', createdAt: 2 },
  ]

  it('picks the own domain even though the platform subdomain is older', async () => {
    const { pool } = poolOf(asOnboarded)
    expect(await primaryDomain(pool, 't1', 'orbetra.com')).toBe('track.reseller.lt')
  })

  it('still picks the platform subdomain when it is the ONLY host they have', async () => {
    // the zero-setup option working as sold — ranking, not exclusion
    const { pool } = poolOf([{ domain: 'reseller.orbetra.com', createdAt: 1 }])
    expect(await primaryDomain(pool, 't1', 'orbetra.com')).toBe('reseller.orbetra.com')
  })

  it('keeps oldest-wins WITHIN the tenant own domains, so the choice stays stable', async () => {
    const { pool } = poolOf([
      { domain: 'later.reseller.lt', createdAt: 5 },
      { domain: 'first.reseller.lt', createdAt: 2 },
      { domain: 'reseller.orbetra.com', createdAt: 1 },
    ])
    expect(await primaryDomain(pool, 't1', 'orbetra.com')).toBe('first.reseller.lt')
  })

  it('falls back to pure oldest-wins when PLATFORM_DOMAIN is not configured', async () => {
    const { pool } = poolOf(asOnboarded)
    expect(await primaryDomain(pool, 't1')).toBe('reseller.orbetra.com')
    expect(await primaryDomain(pool, 't1', '')).toBe('reseller.orbetra.com')
  })

  it('does not mistake a domain that merely ENDS in the same letters', async () => {
    // `notorbetra.com` is not under `orbetra.com`; the suffix comparison includes the dot
    const { pool } = poolOf([
      { domain: 'notorbetra.com', createdAt: 2 },
      { domain: 'x.orbetra.com', createdAt: 1 },
    ])
    expect(await primaryDomain(pool, 't1', 'orbetra.com')).toBe('notorbetra.com')
  })

  it('passes the platform domain as a PARAMETER, never interpolated into the SQL', async () => {
    const { pool, calls } = poolOf(asOnboarded)
    await primaryDomain(pool, 't1', 'orbetra.com')
    expect(calls[0]?.values).toEqual(['t1', 'orbetra.com'])
    expect(calls[0]?.text).not.toContain('orbetra.com')
  })

  it('answers null for an empty tenant id without querying at all', async () => {
    const { pool, calls } = poolOf(asOnboarded)
    expect(await primaryDomain(pool, '')).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

/**
 * The platform origin is a per-caller decision, not something the helper reaches for (audit W-6).
 * It is only defensible where the same message already shows our host — auth mail, whose visible
 * button points there. An alert or a scheduled report carries no URL, so the image would be the only
 * thing naming us.
 */
describe('brandAssetOrigin only names the platform when the caller says it may', () => {
  it('uses the tenant own host when they have one', async () => {
    const { pool } = poolOf([{ domain: 'track.reseller.lt', createdAt: 1 }])
    expect(await brandAssetOrigin(pool, 't1', { platformDomain: 'orbetra.com' })).toBe('https://track.reseller.lt')
  })

  it('returns null — not our host — when the caller offers no platform origin', async () => {
    const { pool } = poolOf([])
    expect(await brandAssetOrigin(pool, 't1', { platformDomain: 'orbetra.com' })).toBeNull()
    // …which drops the relative path at safeHttpsUrl, so the header renders the product name as text
  })

  it('uses the platform origin only when the caller passes one', async () => {
    const { pool } = poolOf([])
    expect(await brandAssetOrigin(pool, 't1', { platformOrigin: 'https://app.orbetra.com/x' })).toBe('https://app.orbetra.com')
  })

  it('a malformed platform origin is null, never a broken src', async () => {
    const { pool } = poolOf([])
    expect(await brandAssetOrigin(pool, 't1', { platformOrigin: 'not a url' })).toBeNull()
  })
})
