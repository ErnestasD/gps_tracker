import { describe, expect, it } from 'vitest'

import { checkPlatformSubdomain, isUnderPlatformDomain } from '../src/routes/tenantSelf.js'

/**
 * A platform subdomain skips DNS proof — we own the zone, so there is nothing for a tenant to
 * publish. That makes this function the ENTIRE ownership check for `<slug>.orbetra.com`, which is
 * why it is tested on its own rather than only through the route.
 */
describe('checkPlatformSubdomain', () => {
  const ROOT = 'orbetra.com'

  it('accepts an ordinary slug', () => {
    for (const s of ['acme', 'acme-fleet', 'a1b2', 'vrumm', 'x'.repeat(40)]) {
      expect(checkPlatformSubdomain(`${s}.${ROOT}`, ROOT), s).toEqual({ ok: true })
    }
  })

  it('refuses every name that is ours, could impersonate us, or would never resolve', () => {
    // our hosts, present and future; names that phish under OUR certificate; mail infrastructure —
    // `hello` carries the SES bounce MX, and a wildcard is skipped for any name that already has a
    // record (RFC 4592), so claiming it would produce a verified domain that is permanently dark
    for (const s of ['dash', 'www', 'api', 'app', 'admin', 'staging', 'grafana', 'secure', 'login', 'billing', 'account', 'mail', 'smtp', 'mx', 'hello', 'autodiscover']) {
      expect(checkPlatformSubdomain(`${s}.${ROOT}`, ROOT).ok, s).toBe(false)
      expect(checkPlatformSubdomain(`${s}.${ROOT}`, ROOT).reason, s).toContain('reserved')
    }
  })

  it('refuses a slug that is too short, too long, or dash-edged', () => {
    for (const s of ['ab', 'a', 'x'.repeat(41), '-acme', 'acme-']) {
      expect(checkPlatformSubdomain(`${s}.${ROOT}`, ROOT).ok, s).toBe(false)
    }
  })

  it('refuses a second level — the wildcard cert only covers one', () => {
    // `*.orbetra.com` matches a.orbetra.com but NOT a.b.orbetra.com, so this would resolve
    // (if a deeper wildcard existed) and then fail TLS, which is the least debuggable outcome
    expect(checkPlatformSubdomain(`deep.nested.${ROOT}`, ROOT).reason).toContain('one level')
  })

  it('refuses the platform domain itself, and anything outside it', () => {
    expect(checkPlatformSubdomain(ROOT, ROOT).reason).toContain('platform domain')
    expect(checkPlatformSubdomain('fleet.customer.lt', ROOT).ok).toBe(false)
    // a look-alike suffix must not pass: `notorbetra.com` ends with `orbetra.com` as a STRING
    expect(checkPlatformSubdomain('evil.notorbetra.com', ROOT).ok).toBe(false)
    expect(isUnderPlatformDomain('evil.notorbetra.com', ROOT)).toBe(false)
  })

  it('is OFF when no platform domain is configured', () => {
    // local, CI and any deploy without the wildcard record: every domain must go through DNS TXT
    expect(checkPlatformSubdomain('acme.orbetra.com', undefined).ok).toBe(false)
    expect(checkPlatformSubdomain('acme.orbetra.com', '  ').ok).toBe(false)
    expect(isUnderPlatformDomain('acme.orbetra.com', undefined)).toBe(false)
  })

  it('routes anything under our zone to the subdomain path, claimable or not', () => {
    // an unclaimable name must be REFUSED, not sent off to publish a TXT record in a zone the
    // tenant cannot edit — that path fails forever with "TXT record not found"
    expect(isUnderPlatformDomain('secure.orbetra.com', ROOT)).toBe(true)
    expect(isUnderPlatformDomain('orbetra.com', ROOT)).toBe(true)
  })
})
