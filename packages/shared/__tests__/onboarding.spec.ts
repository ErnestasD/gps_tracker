import { describe, expect, it } from 'vitest'

import { buildOnboarding } from '../src/onboarding.js'

describe('V1-nice buildOnboarding (SMS device onboarding)', () => {
  it('builds the server-pointing SMS with the empty login+password prefix', () => {
    const s = buildOnboarding({ imei: '860000000000001', host: 'orbetra.com', port: 5027, family: 'fmb1xx' })
    // two leading spaces = empty login + empty password (Teltonika SMS contract)
    expect(s.smsServer).toBe('  setparam 2004:orbetra.com;2005:5027;2003:0')
    expect(s.smsServer.startsWith('  ')).toBe(true)
    expect(s.familyCaveat).toBe(false)
    expect(s.smsApn).toBeNull()
  })

  it('adds the APN SMS only when an APN is given', () => {
    expect(buildOnboarding({ imei: '1', host: 'h', port: 5027 }).smsApn).toBeNull()
    expect(buildOnboarding({ imei: '1', host: 'h', port: 5027, apn: 'internet' }).smsApn).toBe('  setparam 2001:internet')
    expect(buildOnboarding({ imei: '1', host: 'h', port: 5027, apn: '   ' }).smsApn).toBeNull()
  })

  it('sanitizes host/port (SMS field separators must not leak in)', () => {
    // ':' and ';' would break the SMS field structure → fall back to the safe default
    const s = buildOnboarding({ imei: '1', host: 'evil;setparam 9999:x', port: 5027 })
    expect(s.host).toBe('orbetra.com')
    expect(s.smsServer).not.toContain('9999')
    expect(buildOnboarding({ imei: '1', host: 'h', port: 99999 }).port).toBe(5027)
  })

  it('flags an unknown device family with a caveat step', () => {
    const s = buildOnboarding({ imei: '1', host: 'h', port: 5027, family: 'exotic-x' })
    expect(s.familyCaveat).toBe(true)
    expect(s.steps.some((x) => x.includes('may use different parameters'))).toBe(true)
  })

  it('rejects a non-ASCII APN (would be mangled over GSM)', () => {
    expect(buildOnboarding({ imei: '1', host: 'h', port: 5027, apn: 'inter–net' }).smsApn).toBeNull()
  })
})
