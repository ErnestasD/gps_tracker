import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { fakeDb } from './helpers/auth.js'

/**
 * The API's own vendor-named surfaces (audit W-10).
 *
 * `/v1/docs` and `/v1/openapi.json` carry our name — `title: 'Orbetra API'`, "the REST API behind
 * the Orbetra platform", a link to orbetra.com/docs — and are registered BEFORE the `/v1/*` auth
 * guard, so they answered identically on a reseller's hostname. Nothing was exposed in practice,
 * because the Caddy tenant block 404s both. The finding is that the whole property rested on four
 * lines of one site block, with no API-side check and nothing pinning it.
 *
 * This codebase already decided that is not enough for a platform surface and built the second lock
 * for the neighbouring route — `/v1/internal/caddy-ask`, whose test says *"the Caddyfile 404s
 * /v1/internal/* at every host block; this is the second lock, so a future host block that forgets
 * it cannot silently re-open the door."* These are the same lock for the docs.
 */
function appWith(tenantHosts: string[]) {
  const db = fakeDb()
  return createApp({
    redis: {} as never,
    redisSub: {} as never,
    db: {
      ...db,
      tenantDomains: {
        ...db.tenantDomains,
        tenantIdForDomain: (host: string) => Promise.resolve(tenantHosts.includes(host) ? 't1' : null),
      },
    },
    jwtSecret: 'x'.repeat(32),
    jwtTtlS: 900,
    refreshTtlS: 3600,
    lockout: { maxFails: 5, windowS: 900 },
    secureCookies: false,
    trustProxy: true,
  })
}

describe('the API docs are ours, and say so only on our own hosts', () => {
  const onHost = (app: ReturnType<typeof appWith>, path: string, host: string) =>
    app.request(path, { headers: { 'x-forwarded-host': host } })

  it('serves both documents on a host that belongs to nobody', async () => {
    const app = appWith(['fleet.reseller.lt'])
    expect((await onHost(app, '/v1/docs', 'dash.orbetra.test')).status).toBe(200)
    expect((await onHost(app, '/v1/openapi.json', 'dash.orbetra.test')).status).toBe(200)
  })

  it('404s BOTH on a verified tenant hostname, without help from the edge', async () => {
    const app = appWith(['fleet.reseller.lt'])
    expect((await onHost(app, '/v1/docs', 'fleet.reseller.lt')).status).toBe(404)
    expect((await onHost(app, '/v1/openapi.json', 'fleet.reseller.lt')).status).toBe(404)
  })

  it('the served document really does carry the vendor name — otherwise the test above proves nothing', async () => {
    const app = appWith([])
    const spec = (await (await onHost(app, '/v1/openapi.json', 'dash.orbetra.test')).json()) as { info: { title: string } }
    expect(spec.info.title).toContain('Orbetra')
    expect(await (await onHost(app, '/v1/docs', 'dash.orbetra.test')).text()).toContain('Orbetra')
  })

  it('a database fault serves the docs rather than hiding them', async () => {
    // fail direction is deliberate: an unreachable database must not take down our own API
    // reference, and Caddy is still the outer lock.
    const db = fakeDb()
    const app = createApp({
      redis: {} as never,
      redisSub: {} as never,
      db: { ...db, tenantDomains: { ...db.tenantDomains, tenantIdForDomain: () => Promise.reject(new Error('pg down')) } },
      jwtSecret: 'x'.repeat(32),
      jwtTtlS: 900,
      refreshTtlS: 3600,
      lockout: { maxFails: 5, windowS: 900 },
      secureCookies: false,
      trustProxy: true,
    })
    expect((await app.request('/v1/docs', { headers: { 'x-forwarded-host': 'fleet.reseller.lt' } })).status).toBe(200)
  })

  it('ignores a forged X-Forwarded-Host when we are not behind the proxy', async () => {
    const db = fakeDb()
    const app = createApp({
      redis: {} as never,
      redisSub: {} as never,
      db: { ...db, tenantDomains: { ...db.tenantDomains, tenantIdForDomain: (h: string) => Promise.resolve(h === 'fleet.reseller.lt' ? 't1' : null) } },
      jwtSecret: 'x'.repeat(32),
      jwtTtlS: 900,
      refreshTtlS: 3600,
      lockout: { maxFails: 5, windowS: 900 },
      secureCookies: false,
      trustProxy: false,
    })
    // trustProxy=false ⇒ the header is client-controlled and must not decide anything
    expect((await app.request('/v1/docs', { headers: { 'x-forwarded-host': 'fleet.reseller.lt' } })).status).toBe(200)
  })
})
