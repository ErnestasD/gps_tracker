import { describe, expect, it } from 'vitest'

import { buildOnboarding } from '../src/onboarding.js'

describe('V1-nice buildOnboarding (SMS device onboarding)', () => {
  it('builds the server-pointing SMS with the empty login+password prefix', () => {
    // a catalogued MODEL profile — the ordinary case since the picker offers 105 of them
    const s = buildOnboarding({ imei: '860000000000001', host: 'orbetra.com', port: 5027, family: 'fmb120', legacyProfile: false })
    // two leading spaces = empty login + empty password (Teltonika SMS contract); 2006:0 = TCP
    // (2003 is the APN PASSWORD, not the protocol — must never appear here)
    expect(s.smsServer!).toBe('  setparam 2004:orbetra.com;2005:5027;2006:0')
    expect(s.smsServer!.startsWith('  ')).toBe(true)
    expect(s.smsServer!).not.toContain('2003') // never touch the APN password
    expect(s.familyCaveat).toBe(false)
    expect(s.smsApn).toBeNull()
  })

  it('adds the APN SMS only when an APN is given', () => {
    expect(buildOnboarding({ imei: '1', host: 'h', port: 5027 }).smsApn).toBeNull()
    expect(buildOnboarding({ imei: '1', host: 'h', port: 5027, apn: 'internet' }).smsApn).toBe('  setparam 2001:internet')
    expect(buildOnboarding({ imei: '1', host: 'h', port: 5027, apn: '   ' }).smsApn).toBeNull()
  })

  it('smsAuto = the ONE SMS the gateway sends: APN + server combined (server-only without APN)', () => {
    // no APN → identical to smsServer (the device must auto-detect the APN)
    expect(buildOnboarding({ imei: '1', host: 'orbetra.com', port: 5027 }).smsAuto).toBe('  setparam 2004:orbetra.com;2005:5027;2006:0')
    // with APN → 2001 prepended into the SAME setparam so one SMS sets data + server atomically
    expect(buildOnboarding({ imei: '1', host: 'orbetra.com', port: 5027, apn: 'banga' }).smsAuto).toBe('  setparam 2001:banga;2004:orbetra.com;2005:5027;2006:0')
    // still one 160-char GSM-7 segment
    expect(buildOnboarding({ imei: '1', host: 'orbetra.com', port: 5027, apn: 'banga' }).smsAuto!.length).toBeLessThanOrEqual(160)
    // empty login+password prefix preserved; APN password (2003) never touched
    expect(buildOnboarding({ imei: '1', host: 'orbetra.com', port: 5027, apn: 'banga' }).smsAuto!.startsWith('  ')).toBe(true)
    expect(buildOnboarding({ imei: '1', host: 'orbetra.com', port: 5027, apn: 'banga' }).smsAuto).not.toContain('2003')
  })

  it('a bad/injecting APN drops out of smsAuto too (server-only, no second setparam)', () => {
    for (const evil of ['x;2004:evil.com', 'a:b', 'x 2004:y']) {
      const auto = buildOnboarding({ imei: '1', host: 'orbetra.com', port: 5027, apn: evil }).smsAuto
      expect(auto, evil).toBe('  setparam 2004:orbetra.com;2005:5027;2006:0')
      expect(auto).not.toContain('2001')
    }
  })

  it('sanitizes host/port (SMS field separators must not leak in)', () => {
    // ':' and ';' would break the SMS field structure → REFUSE. It used to substitute a default
    // hostname, which quietly turned an injection attempt into a valid command pointed at us.
    const s = buildOnboarding({ imei: '1', host: 'evil;setparam 9999:x', port: 5027 })
    expect(s.host).toBeNull()
    expect(s.smsServer).toBeNull()
    expect(buildOnboarding({ imei: '1', host: 'h', port: 99999 }).port).toBe(5027)
  })

  it('the caveat means "we do not know this hardware", not "the name is unfamiliar"', () => {
    // It used to be keyed on a name allow-list holding the three LEGACY family keys — precisely
    // the ones the picker stopped offering — so every device created through the 105-model picker
    // was told its parameters might be wrong, including a plain FMB120 whose commands come from
    // that model's own wiki page. A warning on 100% of devices carries no information.
    const legacy = buildOnboarding({ imei: '1', host: 'h', port: 5027, family: 'fmb1xx', legacyProfile: true })
    expect(legacy.familyCaveat).toBe(true)
    expect(legacy.steps.some((x) => x.includes('may use different parameters'))).toBe(true)

    for (const model of ['fmb120', 'fmc650', 'atc700', 'exotic-x']) {
      const s = buildOnboarding({ imei: '1', host: 'h', port: 5027, family: model, legacyProfile: false })
      expect(s.familyCaveat, model).toBe(false)
      expect(s.steps.some((x) => x.includes('may use different parameters')), model).toBe(false)
    }

    // …and an omitted flag still warns: unknown is the safe side.
    expect(buildOnboarding({ imei: '1', host: 'h', port: 5027 }).familyCaveat).toBe(true)
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

describe('an unconfigured ingest host is a VISIBLE gap, never our domain', () => {
  it('yields null commands rather than falling back to the platform hostname', () => {
    // the fallback used to be `orbetra.com`, so a deployment that never set INGEST_PUBLIC_HOST told
    // a reseller's installer to point their customer's hardware at OUR domain — and that string is
    // written INTO the tracker, where any technician servicing the vehicle reads it back
    const s = buildOnboarding({ imei: '1', host: '', port: 5027 })
    expect(s.host).toBeNull()
    expect(s.smsServer).toBeNull()
    expect(s.smsAuto).toBeNull()
    expect(JSON.stringify(s)).not.toContain('orbetra')
  })

  it('rejects a malformed host the same way — no silent substitution', () => {
    for (const host of ['not a host', 'a;b', 'x'.repeat(254)]) {
      expect(buildOnboarding({ imei: '1', host, port: 5027 }).host, host).toBeNull()
    }
  })
})
