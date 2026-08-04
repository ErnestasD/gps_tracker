import { describe, expect, it } from 'vitest'

import { buildOnboarding } from '../src/onboarding.js'
import { isAllowedSmsCommand } from '../src/sms.js'

/**
 * The SMS route sends from the PLATFORM's shared Twilio sender to a caller-chosen E.164 number,
 * and every message is unrecoverable platform spend. A caller-supplied body used to be arbitrary
 * 320-char text — a smishing relay wearing a device-command costume (audit high).
 */
describe('isAllowedSmsCommand', () => {
  it('accepts everything the onboarding generator itself produces', () => {
    // if the allow-list ever rejected our OWN output, onboarding would break silently
    for (const input of [
      { imei: '356307042441013', host: 'orbetra.com', port: 5027 },
      { imei: '356307042441013', host: 'eu-1.orbetra.com', port: 5028, apn: 'internet' },
      { imei: '356307042441013', host: '185.80.129.33', port: 5027, apn: 'banga.lt' },
    ]) {
      const sheet = buildOnboarding(input)
      expect(isAllowedSmsCommand(sheet.smsAuto), sheet.smsAuto).toBe(true)
      expect(isAllowedSmsCommand(sheet.smsServer), sheet.smsServer).toBe(true)
      if (sheet.smsApn !== null) expect(isAllowedSmsCommand(sheet.smsApn), sheet.smsApn).toBe(true)
    }
  })

  it('accepts the diagnostics, including getparam WITH an id', () => {
    for (const ok of ['  getinfo', '  getstatus', '  getgps', '  getver', '  cpureset', '  getparam 2004']) {
      expect(isAllowedSmsCommand(ok), ok).toBe(true)
    }
    expect(isAllowedSmsCommand('  getparam')).toBe(false) // does nothing on the device
  })

  it('rejects free-form text, injection and near-misses', () => {
    for (const bad of [
      'Your parcel is held, pay at http://evil.test',
      'setparam 2004:host', // missing the two-space empty-login prefix (Teltonika SMS contract)
      '  setparam 2004:host evil', // space smuggles a second token
      '  setparam 2004:ho st', // space inside the value
      '  setparam 2004:host\n  cpureset', // newline chaining — `$` is end-of-INPUT without /m
      '  setparam 2004:hоst', // Cyrillic о — non-ASCII is not in the value charset
      '  getinfo extra',
      '',
      `  setparam 2004:${'a'.repeat(400)}`, // over the 320-char SMS bound
    ]) {
      expect(isAllowedSmsCommand(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('is linear on adversarial input (no catastrophic backtracking)', () => {
    const started = Date.now()
    for (let i = 0; i < 2_000; i++) isAllowedSmsCommand(`  setparam ${'1:a;'.repeat(60)}`)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
