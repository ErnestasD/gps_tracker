import type { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'

import type { RouteOptimizeResult, RouteStop } from '@orbetra/shared'

import { createApp } from '../src/app.js'
import { mintTestToken, testApiDeps } from './helpers/auth.js'
import type { ApiDeps } from '../src/app.js'

/** Fake redis whose EVAL drives the fixed-window counter (apiKeyAuth.spec pattern). */
function fakeRedis(start = 0) {
  let n = start
  const evalFn = vi.fn(() => Promise.resolve(++n))
  const redis = { eval: evalFn } as unknown as Redis
  return { redis, evalFn }
}

const STOPS: RouteStop[] = [
  { lat: 54.687, lon: 25.28, label: 'Vilnius HQ' },
  { lat: 54.9, lon: 23.91 },
]

/** Canned OSRM /trip body: optimal order swaps the two stops. */
const OSRM_OK = {
  code: 'Ok',
  trips: [
    {
      geometry: { type: 'LineString', coordinates: [[23.91, 54.9], [25.28, 54.687]] },
      legs: [{ duration: 3600, distance: 95_000 }],
      duration: 3600,
      distance: 95_000,
    },
  ],
  waypoints: [{ waypoint_index: 1 }, { waypoint_index: 0 }],
}

const osrmJson = (body: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))) as unknown as typeof fetch

function buildApp(over: Partial<ApiDeps> = {}, redisStart = 0) {
  const { redis, evalFn } = fakeRedis(redisStart)
  const app = createApp(testApiDeps({ redis, redisSub: redis, ticketTtlS: 30 }, over))
  return { app, evalFn }
}

const token = () => mintTestToken({ userId: 'u1', tenantId: 't1', role: 'viewer' })

const optimize = (app: ReturnType<typeof buildApp>['app'], auth: string | null, body: unknown) =>
  app.request('/v1/routing/optimize', {
    method: 'POST',
    headers: { ...(auth !== null ? { authorization: `Bearer ${auth}` } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('ADR-029 POST /v1/routing/optimize', () => {
  it('401s without a token', async () => {
    const { app } = buildApp({ osrm: { url: 'http://osrm', fetchImpl: osrmJson(OSRM_OK) } })
    expect((await optimize(app, null, { stops: STOPS })).status).toBe(401)
  })

  it('503s when OSRM is not configured — BEFORE spending rate-limit budget', async () => {
    const { app, evalFn } = buildApp()
    const res = await optimize(app, await token(), { stops: STOPS })
    expect(res.status).toBe(503)
    expect(evalFn).not.toHaveBeenCalled()
  })

  it('400s a bad body (1 stop / lat out of range)', async () => {
    const { app } = buildApp({ osrm: { url: 'http://osrm', fetchImpl: osrmJson(OSRM_OK) } })
    expect((await optimize(app, await token(), { stops: [STOPS[0]] })).status).toBe(400)
    expect((await optimize(app, await token(), { stops: [{ lat: 91, lon: 25 }, STOPS[1]] })).status).toBe(400)
  })

  it('200 happy path: optimized order + totals, OSRM called with the exact trip path', async () => {
    const fetchImpl = osrmJson(OSRM_OK)
    const { app } = buildApp({ osrm: { url: 'http://osrm:5000', fetchImpl } })
    const res = await optimize(app, await token(), { stops: STOPS, roundtrip: false })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as RouteOptimizeResult
    expect(body.order).toEqual([1, 0]) // visit input 1 first
    expect(body.stops.map((s) => s.inputIndex)).toEqual([1, 0])
    expect(body.totalDurationS).toBe(3600)
    expect(body.totalDistanceM).toBe(95_000)
    expect(body.legs).toEqual([{ durationS: 3600, distanceM: 95_000 }])
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(url).toBe(
      'http://osrm:5000/trip/v1/driving/25.28,54.687;23.91,54.9?roundtrip=false&source=first&destination=last&geometries=geojson&overview=full&steps=false',
    )
  })

  it('422s an unroutable trip (NoSegment) and names the covered region', async () => {
    const { app } = buildApp({ osrm: { url: 'http://osrm', fetchImpl: osrmJson({ code: 'NoSegment', message: 'x' }, 400) } })
    const res = await optimize(app, await token(), { stops: STOPS })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { detail: string }
    expect(body.detail).toContain('Lithuania')
  })

  it('502s when OSRM is unreachable (fetch rejects) or answers garbage', async () => {
    const reject = vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch
    const { app } = buildApp({ osrm: { url: 'http://osrm', fetchImpl: reject } })
    expect((await optimize(app, await token(), { stops: STOPS })).status).toBe(502)

    const { app: app2 } = buildApp({ osrm: { url: 'http://osrm', fetchImpl: osrmJson({ code: 'Ok', trips: [] }) } })
    expect((await optimize(app2, await token(), { stops: STOPS })).status).toBe(502)
  })

  it('429s over the per-user limit (fixed window)', async () => {
    // counter starts at 30 → first eval returns 31 > 30 → limited before any fetch
    const fetchImpl = osrmJson(OSRM_OK)
    const { app } = buildApp({ osrm: { url: 'http://osrm', fetchImpl } }, 30)
    const res = await optimize(app, await token(), { stops: STOPS })
    expect(res.status).toBe(429)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
