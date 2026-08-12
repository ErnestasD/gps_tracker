import { describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'

import { createApp, createApiProm } from '../src/app.js'
import { fakeDb, TEST_JWT_SECRET } from './helpers/auth.js'

const stub = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve('OK'),
  del: () => Promise.resolve(0),
  eval: () => Promise.resolve(1),
  incr: () => Promise.resolve(1),
  expire: () => Promise.resolve(1),
  ttl: () => Promise.resolve(-1),
  mget: () => Promise.resolve([]),
  pipeline: () => {
    const chain: Record<string, unknown> = {}
    for (const m of ['get', 'set', 'del', 'eval', 'incr', 'expire', 'pfcount', 'pfadd', 'hget', 'sadd', 'srem'])
      chain[m] = () => chain
    chain['exec'] = () => Promise.resolve([[null, 0], [null, 0]])
    return chain
  },
} as unknown as Redis

describe('C26 probe: is a forged SES post scrapeable without onSesEvent?', () => {
  it('counts the 403 under the route TEMPLATE, and fires no hook when main-style deps omit onSesEvent', async () => {
    const prom = createApiProm()
    const app = createApp(
      {
        redis: stub,
        redisSub: stub,
        db: fakeDb(),
        jwtSecret: TEST_JWT_SECRET,
        jwtTtlS: 900,
        refreshTtlS: 3600,
        lockout: { maxFails: 5, windowS: 900 },
        secureCookies: false,
        trustProxy: false,
        getRemoteAddr: () => '127.0.0.1',
      },
      prom,
    )

    const res = await app.request('/v1/webhooks/ses', {
      method: 'POST',
      body: JSON.stringify({ Type: 'Notification', MessageId: 'x', Signature: 'AAAA', SignatureVersion: '2', SigningCertURL: 'https://evil.example.com/c.pem', Message: '{}', Timestamp: 't', TopicArn: 'arn' }),
      headers: { 'content-type': 'application/json' },
    })
    // eslint-disable-next-line no-console
    console.log('PROBE status =', res.status, await res.text())

    const badJson = await app.request('/v1/webhooks/ses', {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    })
    // eslint-disable-next-line no-console
    console.log('PROBE badjson status =', badJson.status)

    const metrics = await prom.registry.metrics()
    const lines = metrics.split('\n').filter((l) => l.includes('webhooks/ses') || l.startsWith('ses_'))
    // eslint-disable-next-line no-console
    console.log('PROBE metrics lines:\n' + lines.join('\n'))
    // eslint-disable-next-line no-console
    console.log('PROBE any ses_ series:', metrics.split('\n').filter((l) => /^ses_/.test(l)).length)
    expect(res.status).toBe(403)
  })
})
