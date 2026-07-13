import { describe, expect, it } from 'vitest'

import { buildOnboarding } from '../src/onboarding.js'

describe('V1-nice buildOnboarding (SMS device onboarding)', () => {
  it('builds the server-pointing SMS with the empty login+password prefix', () => {
    const s = buildOnboarding({ imei: '860000000000001', host: 'orbetra.com', port: 5027, family: 'fmb1xx' })
    // two leading spaces = empty login + empty password (Teltonika SMS contract); 2006:0 = TCP
    // (2003 is the APN PASSWORD, not the protocol — must never appear here)
    expect(s.smsServer).toBe('  setparam 2004:orbetra.com;2005:5027;2006:0')
    expect(s.smsServer.startsWith('  ')).toBe(true)
    expect(s.smsServer).not.toContain('2003') // never touch the APN password
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

  it('rejects an APN carrying SMS separators — the injection vector (review HIGH)', () => {
    // ';' and ':' are printable ASCII, so the old /[\x20-\x7e]/ filter let them through and a
    // crafted APN injected a second setparam (redirect the device / rewrite the APN password)
    for (const evil of ['x;2004:evil.com', 'a:b', 'net;2006:1', 'x 2004:y', 'a;b']) {
      expect(buildOnboarding({ imei: '1', host: 'h', port: 5027, apn: evil }).smsApn, evil).toBeNull()
    }
    // an over-long APN (>63) is also dropped (server-side cap, not just the web maxLength)
    expect(buildOnboarding({ imei: '1', host: 'h', port: 5027, apn: 'a'.repeat(64) }).smsApn).toBeNull()
    // a legitimate hostname-like APN with dots/dashes still works
    expect(buildOnboarding({ imei: '1', host: 'h', port: 5027, apn: 'wap.o2.co.uk' }).smsApn).toBe('  setparam 2001:wap.o2.co.uk')
  })
})
