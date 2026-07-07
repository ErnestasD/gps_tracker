import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * lib/auth.ts session tests (E03-1). Module state is per-import — vi.resetModules
 * + dynamic import gives each test a clean session.
 */

const session = (token: string) => ({
  accessToken: token,
  expiresInS: 900,
  user: { id: 'u1', email: 'a@b.c', role: 'viewer', tenantId: 't1', accountId: 'acc-a', locale: 'en' },
})

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const importAuth = () => import('../src/lib/auth.js')
const importApi = () => import('../src/lib/api.js')

describe('login/logout', () => {
  it('login stores the in-memory token and user; logout clears both', async () => {
    const auth = await importAuth()
    fetchMock.mockResolvedValueOnce(jsonResponse(200, session('tok-1')))
    const user = await auth.login('a@b.c', 'pw')
    expect(user.role).toBe('viewer')
    expect(auth.getAccessToken()).toBe('tok-1')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    await auth.logout()
    expect(auth.getAccessToken()).toBeNull()
    expect(auth.getCurrentUser()).toBeNull()
  })

  it('login maps failure statuses into ApiError', async () => {
    const auth = await importAuth()
    const { ApiError } = await import('../src/lib/http.js')
    fetchMock.mockResolvedValueOnce(jsonResponse(429, {}))
    await expect(auth.login('a@b.c', 'pw')).rejects.toThrowError(ApiError)
    expect(auth.getAccessToken()).toBeNull()
  })

  it('logout clears locally even when the server is unreachable', async () => {
    const auth = await importAuth()
    fetchMock.mockResolvedValueOnce(jsonResponse(200, session('tok-1')))
    await auth.login('a@b.c', 'pw')
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await auth.logout()
    expect(auth.getAccessToken()).toBeNull()
  })
})

describe('refreshSession single-flight', () => {
  it('concurrent callers share ONE /v1/auth/refresh request (a second would kill the family)', async () => {
    const auth = await importAuth()
    let resolveFetch: (r: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolveFetch = r)))
    const [p1, p2] = [auth.refreshSession(), auth.refreshSession()]
    resolveFetch!(jsonResponse(200, session('tok-2')))
    expect(await p1).toBe(true)
    expect(await p2).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(auth.getAccessToken()).toBe('tok-2')
  })

  it('failed refresh clears the session and returns false', async () => {
    const auth = await importAuth()
    fetchMock.mockResolvedValueOnce(jsonResponse(200, session('tok-1')))
    await auth.login('a@b.c', 'pw')
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}))
    expect(await auth.refreshSession()).toBe(false)
    expect(auth.getAccessToken()).toBeNull()
  })
})

describe('apiFetch 401 → refresh → retry-once', () => {
  it('retries exactly once after a successful refresh', async () => {
    const auth = await importAuth()
    const api = await importApi()
    fetchMock.mockResolvedValueOnce(jsonResponse(200, session('tok-old')))
    await auth.login('a@b.c', 'pw')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {})) // data request with stale token
      .mockResolvedValueOnce(jsonResponse(200, session('tok-new'))) // refresh
      .mockResolvedValueOnce(jsonResponse(200, { devices: [] })) // retried data request
    const devices = await api.getLastPositions()
    expect(devices).toEqual([])
    const lastCall = fetchMock.mock.calls.at(-1)!
    expect((lastCall[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok-new' })
  })

  it('bounded: refresh fails → ApiError(401), session cleared, no retry loop', async () => {
    const auth = await importAuth()
    const api = await importApi()
    fetchMock.mockResolvedValueOnce(jsonResponse(200, session('tok-old')))
    await auth.login('a@b.c', 'pw')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {})) // data request
      .mockResolvedValueOnce(jsonResponse(401, {})) // refresh dies
    await expect(api.getLastPositions()).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(auth.getAccessToken()).toBeNull()
  })

  it('second 401 after successful refresh does not loop (retried flag)', async () => {
    const auth = await importAuth()
    const api = await importApi()
    fetchMock.mockResolvedValueOnce(jsonResponse(200, session('tok-old')))
    await auth.login('a@b.c', 'pw')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {})) // data request
      .mockResolvedValueOnce(jsonResponse(200, session('tok-new'))) // refresh ok
      .mockResolvedValueOnce(jsonResponse(401, {})) // retry STILL 401
    await expect(api.getLastPositions()).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
