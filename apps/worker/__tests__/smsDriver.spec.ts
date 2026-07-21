import { describe, expect, it, vi } from 'vitest'

import { isPermanent, smsDriverFromEnv, SmsSendError, twilioDriver, type TwilioConfig } from '../src/sms/drivers.js'

/** A fetch stub returning a Twilio-shaped response. */
function fakeFetch(res: { ok: boolean; status: number; body?: unknown }) {
  return vi.fn(() =>
    Promise.resolve({
      ok: res.ok,
      status: res.status,
      json: () => Promise.resolve(res.body ?? {}),
    } as unknown as Response),
  )
}

const decodeBasic = (auth: string): [string, string] => {
  const raw = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString()
  const i = raw.indexOf(':')
  return [raw.slice(0, i), raw.slice(i + 1)]
}

describe('twilioDriver', () => {
  it('POSTs the Messages resource with Account-SID auth, form body, and returns the sid', async () => {
    const fetchImpl = fakeFetch({ ok: true, status: 201, body: { sid: 'SM_abc' } })
    const cfg: TwilioConfig = { accountSid: 'AC 123/x', from: '+15550001111', authToken: 'tok-secret' }
    const out = await twilioDriver(cfg, fetchImpl).send('+37060000000', 'hello world')

    expect(out).toEqual({ providerMessageId: 'SM_abc' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    // account sid is URL-encoded into the path
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent('AC 123/x')}/Messages.json`)
    const headers = init.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded')
    // auth-token mode: Basic user = account sid, pass = auth token
    expect(decodeBasic(headers['authorization']!)).toEqual(['AC 123/x', 'tok-secret'])
    const form = new URLSearchParams(init.body as string)
    expect(form.get('To')).toBe('+37060000000')
    expect(form.get('From')).toBe('+15550001111')
    expect(form.get('Body')).toBe('hello world')
  })

  it('uses the API-Key pair for Basic auth but keeps the account SID in the URL', async () => {
    const fetchImpl = fakeFetch({ ok: true, status: 201, body: { sid: 'SM_key' } })
    const cfg: TwilioConfig = { accountSid: 'AC_main', from: '+1', apiKeySid: 'SK_key', apiKeySecret: 'k-secret' }
    await twilioDriver(cfg, fetchImpl).send('+370', 'x')

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/Accounts/AC_main/Messages.json') // URL uses accountSid, not the key sid
    const headers = init.headers as Record<string, string>
    expect(decodeBasic(headers['authorization']!)).toEqual(['SK_key', 'k-secret'])
  })

  it('throws a transient SmsSendError on 500 and 429 (retryable)', async () => {
    const cfg: TwilioConfig = { accountSid: 'AC', from: '+1', authToken: 't' }
    for (const status of [500, 429]) {
      const err = await twilioDriver(cfg, fakeFetch({ ok: false, status }))
        .send('+370', 'x')
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(SmsSendError)
      expect((err as SmsSendError).status).toBe(status)
      expect(isPermanent((err as SmsSendError).status)).toBe(false)
    }
  })

  it('throws a permanent SmsSendError on a 400 (bad request — no retry)', async () => {
    const cfg: TwilioConfig = { accountSid: 'AC', from: '+1', authToken: 't' }
    const err = await twilioDriver(cfg, fakeFetch({ ok: false, status: 400 }))
      .send('+370', 'x')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SmsSendError)
    expect((err as SmsSendError).status).toBe(400)
    expect(isPermanent((err as SmsSendError).status)).toBe(true)
  })

  it('treats a 2xx with no sid as a send failure', async () => {
    const cfg: TwilioConfig = { accountSid: 'AC', from: '+1', authToken: 't' }
    await expect(twilioDriver(cfg, fakeFetch({ ok: true, status: 200, body: {} })).send('+370', 'x')).rejects.toThrow('no sid')
  })
})

describe('isPermanent', () => {
  it('classifies 4xx (except 429) permanent, and 429/5xx/network transient', () => {
    expect(isPermanent(400)).toBe(true)
    expect(isPermanent(401)).toBe(true)
    expect(isPermanent(404)).toBe(true)
    expect(isPermanent(429)).toBe(false) // rate limited → retry
    expect(isPermanent(500)).toBe(false)
    expect(isPermanent(503)).toBe(false)
    expect(isPermanent(0)).toBe(false) // network error → retry
  })
})

describe('smsDriverFromEnv', () => {
  it('returns undefined when SMS is not configured', () => {
    expect(smsDriverFromEnv({})).toBeUndefined()
    expect(smsDriverFromEnv({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_FROM: '+1' })).toBeUndefined() // no auth
  })

  it('builds an auth-token driver when the token is present', async () => {
    const fetchImpl = fakeFetch({ ok: true, status: 201, body: { sid: 'SM1' } })
    const driver = smsDriverFromEnv({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_FROM: '+1', TWILIO_AUTH_TOKEN: 'tok' }, fetchImpl)
    expect(driver).toBeDefined()
    await driver!.send('+370', 'x')
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(decodeBasic(headers['authorization']!)).toEqual(['AC', 'tok'])
  })

  it('builds an API-key driver when only the key pair is present', async () => {
    const fetchImpl = fakeFetch({ ok: true, status: 201, body: { sid: 'SM1' } })
    const driver = smsDriverFromEnv({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_FROM: '+1', TWILIO_API_KEY_SID: 'SK', TWILIO_API_KEY_SECRET: 'sec' }, fetchImpl)
    expect(driver).toBeDefined()
    await driver!.send('+370', 'x')
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(decodeBasic(headers['authorization']!)).toEqual(['SK', 'sec'])
  })
})
