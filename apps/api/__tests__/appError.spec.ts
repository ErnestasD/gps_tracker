import { HTTPException } from 'hono/http-exception'
import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { fakeDb } from './helpers/auth.js'

/**
 * Global app.onError (systemic 500 fix). An UNHANDLED Prisma error is translated to the right status
 * — chiefly a non-UUID `:id` (P2023 → 404) that used to 500 on every item route — while an
 * intentional HTTPException passes through and a truly unexpected error still 500s (as problem+json).
 */
function makeApp() {
  return createApp({
    redis: {} as never, redisSub: {} as never, db: fakeDb(),
    jwtSecret: 'x'.repeat(32), jwtTtlS: 900, refreshTtlS: 3600,
    lockout: { maxFails: 5, windowS: 900 }, secureCookies: false, trustProxy: false,
  })
}

describe('app.onError', () => {
  it('maps an unhandled Prisma P2023 (malformed uuid) to 404 problem+json', async () => {
    const app = makeApp()
    app.get('/p2023', () => { throw Object.assign(new Error('bad uuid'), { code: 'P2023' }) })
    const res = await app.request('/p2023')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    expect((await res.json() as { title: string }).title).toBe('Not Found')
  })

  it('maps an unhandled P2002 (unique clash) to 409', async () => {
    const app = makeApp()
    app.get('/p2002', () => { throw Object.assign(new Error('dup'), { code: 'P2002' }) })
    expect((await app.request('/p2002')).status).toBe(409)
  })

  it('passes an intentional HTTPException through unchanged', async () => {
    const app = makeApp()
    app.get('/teapot', () => { throw new HTTPException(418, { message: 'teapot' }) })
    const res = await app.request('/teapot')
    expect(res.status).toBe(418)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff') // headers apply on passthrough too
  })

  it('still 500s a truly unexpected error (as problem+json)', async () => {
    const app = makeApp()
    app.get('/boom', () => { throw new Error('kaboom') })
    const res = await app.request('/boom')
    expect(res.status).toBe(500)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff') // headers still applied
  })
})
