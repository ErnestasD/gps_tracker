import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `primeMapToken` — the call that decides whether a white-label tenant sees a map.
 *
 * It shipped without a test and without the bearer: the API reads the `authorization` header only
 * (cookies carry the refresh token, not the access token), so every load got 401, the failure was
 * swallowed as "this deployment does not mint", and the tenant domain kept the black map the whole
 * change existed to fix. Falling back is indistinguishable from never trying — which is exactly
 * why this needs assertions on the REQUEST, not just on the happy path.
 */
vi.mock('mapbox-gl', () => ({ default: { accessToken: '', Map: class {} } }))
vi.mock('../src/lib/auth.js', () => ({
  getAccessToken: () => 'jwt-session',
  refreshSession: () => Promise.resolve(false),
  clearSession: () => undefined,
}))

const HOUR_OUT = new Date(Date.now() + 3_600_000).toISOString()

/**
 * Fresh module state per test. Importing lib/map is what installs the bundled token, so the
 * "unchanged" assertions below read it back rather than hard-coding a value — the local
 * apps/web/.env supplies a real `pk.` here and an empty string in CI.
 */
const load = async () => {
  vi.resetModules()
  const mapboxgl = (await import('mapbox-gl')).default
  const { primeMapToken } = await import('../src/lib/map.js')
  return { mapboxgl, primeMapToken, bundled: mapboxgl.accessToken }
}

const respond = (status: number, body: unknown) =>
  vi.fn<(url?: unknown, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('primeMapToken', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('sends the session bearer — the API reads the header, never the cookie', async () => {
    const fetchMock = respond(200, { token: 'tk.short', expiresAt: HOUR_OUT })
    vi.stubGlobal('fetch', fetchMock)
    const { mapboxgl, primeMapToken } = await load()

    await primeMapToken()

    const init = fetchMock.mock.calls[0]?.[1]
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.['authorization']).toBe('Bearer jwt-session')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/map/token')
    expect(mapboxgl.accessToken).toBe('tk.short')
  })

  it('keeps the bundled token when the deployment does not mint (503)', async () => {
    vi.stubGlobal('fetch', respond(503, { title: 'Service Unavailable' }))
    const { mapboxgl, primeMapToken, bundled } = await load()

    await primeMapToken()

    // the pre-minting behaviour, which still works on our own hosts
    expect(mapboxgl.accessToken).toBe(bundled)
    expect(String(mapboxgl.accessToken).startsWith('tk.')).toBe(false)
  })

  it('keeps the bundled token when the network is gone, rather than throwing into the route guard', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    const { mapboxgl, primeMapToken, bundled } = await load()

    await expect(primeMapToken()).resolves.toBeUndefined()
    expect(mapboxgl.accessToken).toBe(bundled)
  })

  it('asks once per token, not once per navigation — minting is rate limited', async () => {
    const fetchMock = respond(200, { token: 'tk.short', expiresAt: HOUR_OUT })
    vi.stubGlobal('fetch', fetchMock)
    const { primeMapToken } = await load()

    await primeMapToken()
    await primeMapToken()
    await primeMapToken()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-asks when the minted token is already expiring', async () => {
    const fetchMock = respond(200, { token: 'tk.short', expiresAt: new Date(Date.now() + 60_000).toISOString() })
    vi.stubGlobal('fetch', fetchMock)
    const { primeMapToken } = await load()

    // expiry inside the 5-minute margin ⇒ the cache is already stale on the next navigation
    await primeMapToken()
    await primeMapToken()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
