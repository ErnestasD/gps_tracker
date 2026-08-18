import { describe, expect, it } from 'vitest'

import { buildOnboarding, smsPrefixFor } from '../src/onboarding.js'
import { isAllowedSmsCommand } from '../src/sms.js'

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

/**
 * The prefix that stands in for an unset SMS password. Found on real hardware, 2026-08-18: an
 * FTC887 with its lights on, a config SMS Twilio reported as `delivered`, and not one TCP SYN at
 * ingest in 90 seconds. The message was well-formed for the WRONG platform.
 *
 * FMB firmware parses `<login><space><password><space><command>` — two spaces when both are unset
 * (https://wiki.teltonika-gps.com/view/FMB120_SMS/GPRS_Commands). The FT platform has no separate
 * login field: `<password><space><command>`, so one space
 * (https://wiki.teltonika-gps.com/view/FTC887_SMS/GPRS_Command_List). 25 of the 105 catalogued
 * models are FT, and every one of them was being sent an unparseable command.
 */
describe('the SMS password prefix is per-PLATFORM, not one constant', () => {
  it('FT platform (FTC/FTM/ATC/ATM) takes ONE space', () => {
    for (const family of ['ftc887', 'ftc134', 'ftc881', 'ftm134', 'atc700', 'atm700', 'FTC887']) {
      expect(smsPrefixFor(family), family).toBe(' ')
      const s = buildOnboarding({ imei: '1', host: 'orbetra.com', port: 5027, apn: 'internet', family, legacyProfile: false })
      // FTC/FTM additionally carry the unmask parameter — see the separate describe below
      const unmask = /^(ftc|ftm)/i.test(family) ? ';11813:0' : ''
      expect(s.smsAuto, family).toBe(` setparam 2001:internet;2004:orbetra.com;2005:5027;2006:0${unmask}`)
      expect(s.smsServer!.startsWith('  '), `${family} must NOT carry the FMB double space`).toBe(false)
      expect(s.smsServer!.startsWith(' '), family).toBe(true)
    }
  })

  it('everything else keeps TWO — the FMB reading the other 80 models take', () => {
    for (const family of ['fmb120', 'fmc150', 'fmm130', 'fmu125', 'tat100', 'gh5200', 'tst100', 'tmt250', 'msp500', 'mtb100', 'tft100', 'fm36']) {
      expect(smsPrefixFor(family), family).toBe('  ')
      expect(buildOnboarding({ imei: '1', host: 'h', port: 5027, family, legacyProfile: false }).smsServer, family)
        .toBe('  setparam 2004:h;2005:5027;2006:0')
    }
  })

  it('an unknown or legacy family falls back to TWO, not to one', () => {
    // "unknown" must land on the reading that covers 80 of 105 models — and the caveat step already
    // tells the operator to check their model's page.
    for (const family of [undefined, 'fmb1xx', 'fmb6xx-stub', 'tat-asset', 'exotic-x']) {
      expect(smsPrefixFor(family), String(family)).toBe('  ')
    }
  })

  it('a family that merely CONTAINS an FT name is not FT — the prefix is matched at the start', () => {
    // guard against a loose `includes`: these are not FT platform devices.
    for (const family of ['xftc887', 'my-atc700', 'fmb-atm']) expect(smsPrefixFor(family), family).toBe('  ')
  })

  it('an EMPTY value is allowed — clearing a parameter is how a device goes back to stock', () => {
    // Teltonika's own quick-config documents the empty form ("leave field empty if there is no APN
    // username"). Requiring a character meant we could set a wrong APN and never take it back.
    expect(isAllowedSmsCommand(' setparam 2001:')).toBe(true)
    expect(isAllowedSmsCommand(' setparam 2001:;2004:;2005:0;2006:0')).toBe(true)
    expect(isAllowedSmsCommand('  setparam 2004:')).toBe(true)
    // …and it widens nothing else: an injected second command is still refused
    expect(isAllowedSmsCommand(' setparam 2001:;evil')).toBe(false)
    expect(isAllowedSmsCommand(' setparam :')).toBe(false)
    expect(isAllowedSmsCommand(' setparam 2001: 2004:x')).toBe(false)
  })

  it('the allow-list accepts what the sheet generates — for BOTH platforms', () => {
    // The route validates a caller-supplied body against isAllowedSmsCommand. If that regex demanded
    // two spaces, an operator pasting our own FTC887 command back in would be refused by our own
    // validator — the sheet and the guard have to agree.
    const ft = buildOnboarding({ imei: '1', host: 'orbetra.com', port: 5027, apn: 'internet', family: 'ftc887', legacyProfile: false })
    const fmb = buildOnboarding({ imei: '1', host: 'orbetra.com', port: 5027, apn: 'internet', family: 'fmb120', legacyProfile: false })
    for (const cmd of [ft.smsAuto!, ft.smsServer!, ft.smsApn!, fmb.smsAuto!, fmb.smsServer!, fmb.smsApn!]) {
      expect(isAllowedSmsCommand(cmd), cmd).toBe(true)
    }
    // both diagnostic spellings stay allowed…
    expect(isAllowedSmsCommand(' getinfo')).toBe(true)
    expect(isAllowedSmsCommand('  getinfo')).toBe(true)
    // …and the guard still refuses free text, a missing prefix, and an injected second command
    expect(isAllowedSmsCommand('getinfo')).toBe(false)
    expect(isAllowedSmsCommand('   getinfo')).toBe(false)
    expect(isAllowedSmsCommand(' Your parcel is held, pay at http://x.example')).toBe(false)
    expect(isAllowedSmsCommand(' setparam 2004:evil.com x')).toBe(false)
  })
})

/**
 * FTC and FTM ship with their position masked, and onboarding clears it.
 *
 * Parameter 11813 "GPS data masking" defaults to 1 — "GNSS data sent as zero" — inside a Private
 * mode these models cannot leave (switching needs a DIN they do not have; the weekly Business
 * window is factory 00:00–00:00). A brand-new, correctly onboarded tracker therefore transmits
 * zeros for position, satellite count AND the GNSS date, forever, which is indistinguishable from
 * one that cannot see the sky.
 *
 * Measured on hardware 2026-08-18: eight hours of `GNSS Status 2` / `satellites 0` / `Date:1970`
 * on a windowsill, then 16 satellites and a valid fix in the same minute that 11813 went to 0.
 * Founder decision the same day: a masked position contradicts the purpose of the platform.
 */
describe('the models that hide their own position are told not to', () => {
  const sheetFor = (family: string) =>
    buildOnboarding({ imei: '1', host: 'h.example', port: 5027, apn: 'banga', family, legacyProfile: false })

  it('FTC and FTM get 11813:0 on both the sent command and the copy-paste one', () => {
    for (const family of ['ftc887', 'ftc881', 'ftc921', 'ftm134', 'FTM887']) {
      const s = sheetFor(family)
      expect(s.smsAuto, family).toBe(' setparam 2001:banga;2004:h.example;2005:5027;2006:0;11813:0')
      // the manual path must not reproduce the failure for anyone who does not use the button
      expect(s.smsServer, family).toBe(' setparam 2004:h.example;2005:5027;2006:0;11813:0')
    }
  })

  it('ATC and ATM do NOT — they have no such parameter, and naming a missing id risks the whole command', () => {
    // ATC700's parameter list has no 11813; a setparam naming an id the model does not implement
    // may be rejected outright, which would break the onboarding it was meant to fix.
    for (const family of ['atc700', 'atm700', 'atc704']) {
      const s = sheetFor(family)
      expect(s.smsAuto, family).not.toContain('11813')
      expect(s.smsServer, family).toBe(' setparam 2004:h.example;2005:5027;2006:0')
    }
  })

  it('the FMB generation does not either — the parameter does not exist there', () => {
    for (const family of ['fmb120', 'fmc150', 'fmm130', 'tat100']) {
      expect(sheetFor(family).smsAuto, family).not.toContain('11813')
    }
  })

  it('an unknown or legacy family is left alone — we only name ids we know the model has', () => {
    for (const family of ['fmb1xx', 'tat-asset', 'exotic-x']) {
      expect(sheetFor(family).smsAuto, family).not.toContain('11813')
    }
    expect(buildOnboarding({ imei: '1', host: 'h', port: 5027 }).smsAuto).not.toContain('11813')
  })

  it('still one SMS segment, and still passes our own command allow-list', () => {
    const s = buildOnboarding({ imei: '1', host: '185.80.129.33', port: 5027, apn: 'banga', family: 'ftc887', legacyProfile: false })
    expect(s.smsAuto!.length).toBeLessThanOrEqual(160)
    expect(isAllowedSmsCommand(s.smsAuto!)).toBe(true)
    expect(isAllowedSmsCommand(s.smsServer!)).toBe(true)
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

describe('the steps change when WE can send the SMS', () => {
  it('canSend: press the button — not "type this setparam into an SMS yourself"', () => {
    // The sheet was printing hand-send instructions even on a deployment with a working gateway and
    // a saved SIM number. This is the first minute anyone spends with the product, and telling a
    // customer to hand-type `setparam 2004:…` is where they are lost.
    const s = buildOnboarding({ imei: '1', host: 'h', port: 5027, apn: 'internet', legacyProfile: false, canSend: true })
    expect(s.steps.some((x) => x.includes('Send config SMS'))).toBe(true)
    expect(s.steps.some((x) => x.includes('Send the APN SMS below'))).toBe(false)
    expect(s.steps.some((x) => x.includes('Send the server SMS below'))).toBe(false)
    // …and the copy-paste commands are STILL there: the fallback, and the record of what was sent
    expect(s.smsApn).toBe('  setparam 2001:internet')
    expect(s.smsServer).toBe('  setparam 2004:h;2005:5027;2006:0')
  })

  it('without it, the manual instructions stay exactly as they were', () => {
    const s = buildOnboarding({ imei: '1', host: 'h', port: 5027, apn: 'internet', legacyProfile: false })
    expect(s.steps.some((x) => x.includes('Send the APN SMS below'))).toBe(true)
    expect(s.steps.some((x) => x.includes('Send config SMS'))).toBe(false)
  })
})

