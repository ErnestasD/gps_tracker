import { describe, expect, it } from 'vitest'

import { deviceCreateSchema } from '../src/entities.js'
import { SMS_STATUSES, smsConfigured, smsSendRequestSchema } from '../src/sms.js'

describe('smsSendRequestSchema', () => {
  it('accepts an empty body (API builds the config SMS via buildOnboarding)', () => {
    expect(smsSendRequestSchema.parse({}).body).toBeUndefined()
  })
  it('accepts an explicit body + apn', () => {
    const r = smsSendRequestSchema.parse({ body: '  setparam 2004:orbetra.com;2005:5027;2006:0', apn: 'internet' })
    expect(r.body).toContain('setparam')
    expect(r.apn).toBe('internet')
  })
  it('rejects an empty-string body and an over-long body (>320)', () => {
    expect(smsSendRequestSchema.safeParse({ body: '' }).success).toBe(false)
    expect(smsSendRequestSchema.safeParse({ body: 'x'.repeat(321) }).success).toBe(false)
  })
  it('rejects an over-long apn (>63)', () => {
    expect(smsSendRequestSchema.safeParse({ apn: 'a'.repeat(64) }).success).toBe(false)
  })
})

describe('SMS_STATUSES', () => {
  it('is the queued→sent|failed lifecycle', () => {
    expect(SMS_STATUSES).toEqual(['queued', 'sent', 'failed'])
  })
})

describe('smsConfigured', () => {
  const full = { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+15005550006' }
  it('true only when all three Twilio vars are present', () => {
    expect(smsConfigured(full)).toBe(true)
  })
  it('false when the account sid, From, or auth is missing', () => {
    expect(smsConfigured({})).toBe(false)
    expect(smsConfigured({ ...full, TWILIO_FROM: undefined })).toBe(false)
    expect(smsConfigured({ ...full, TWILIO_AUTH_TOKEN: '' })).toBe(false) // no auth of either kind
    expect(smsConfigured({ ...full, TWILIO_ACCOUNT_SID: undefined })).toBe(false)
  })
  it('accepts an API key (SID + secret) as the auth in place of the Auth Token', () => {
    const apiKey = { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_FROM: '+15005550006', TWILIO_API_KEY_SID: 'SK123', TWILIO_API_KEY_SECRET: 'sec' }
    expect(smsConfigured(apiKey)).toBe(true)
    expect(smsConfigured({ ...apiKey, TWILIO_API_KEY_SECRET: undefined })).toBe(false) // half an API key ≠ configured
  })
})

describe('device SIM field regexes (SMS gateway)', () => {
  const base = {
    accountId: '11111111-1111-4111-8111-111111111111',
    profileId: '22222222-2222-4222-8222-222222222222',
    imei: '356307042460001',
    name: 'Van',
  }
  it('accepts a valid E.164 msisdn and 18–22 digit iccid', () => {
    const r = deviceCreateSchema.parse({ ...base, simMsisdn: '+37060000000', simIccid: '8937060000000000001' })
    expect(r.simMsisdn).toBe('+37060000000')
    expect(r.simIccid).toBe('8937060000000000001')
  })
  it('accepts null for both (unset)', () => {
    const r = deviceCreateSchema.parse({ ...base, simMsisdn: null, simIccid: null })
    expect(r.simMsisdn).toBeNull()
    expect(r.simIccid).toBeNull()
  })
  it('rejects a msisdn without + / with a leading zero / non-digits', () => {
    expect(deviceCreateSchema.safeParse({ ...base, simMsisdn: '37060000000' }).success).toBe(false)
    expect(deviceCreateSchema.safeParse({ ...base, simMsisdn: '+0060000000' }).success).toBe(false)
    expect(deviceCreateSchema.safeParse({ ...base, simMsisdn: '+3706abc0000' }).success).toBe(false)
  })
  it('rejects an iccid shorter than 18 / longer than 22 / non-digit', () => {
    expect(deviceCreateSchema.safeParse({ ...base, simIccid: '89370600000' }).success).toBe(false)
    expect(deviceCreateSchema.safeParse({ ...base, simIccid: '8'.repeat(23) }).success).toBe(false)
    expect(deviceCreateSchema.safeParse({ ...base, simIccid: '89370600000000000A' }).success).toBe(false)
  })
})
