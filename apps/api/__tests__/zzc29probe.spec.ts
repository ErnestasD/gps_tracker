import type { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { fakeDb, mintTestToken, testApiDeps } from './helpers/auth.js'

/** C29 fact-finding probe: observe the ACTUAL problem+json bodies for two 503 sites. */
function buildApp() {
  const redis = { eval: vi.fn(() => Promise.resolve(1)) } as unknown as Redis
  const db = fakeDb()
  // scope gate must pass so we reach the 503 branch
  ;(db as unknown as { devices: Record<string, unknown> }).devices = {
    ...(db as unknown as { devices: Record<string, unknown> }).devices,
    get: () => Promise.resolve({ id: 1n, imei: '350000000000001', name: 'd', accountId: 'a1', retiredAt: null }),
  }
  return createApp(testApiDeps({ redis, redisSub: redis, ticketTtlS: 30 }, { db, pool: undefined }))
}

describe('C29 probe', () => {
  it('prints the two 503 bodies', async () => {
    const app = buildApp()
    const token = await mintTestToken({ userId: 'u1', tenantId: 't1', role: 'tsp_admin' })
    const h = { authorization: `Bearer ${token}` }

    const a = await app.request('/v1/driver-scores', { headers: h })
    const aBody = await a.text()
    const b = await app.request('/v1/devices/1/positions', { headers: h })
    const bBody = await b.text()

    // eslint-disable-next-line no-console
    console.log('DRIVER-SCORES', a.status, a.headers.get('content-type'), aBody)
    // eslint-disable-next-line no-console
    console.log('DEVICE-POSITIONS', b.status, b.headers.get('content-type'), bBody)
    expect(a.status).toBe(503)
  })
})
