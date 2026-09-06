import { describe, expect, it, vi } from 'vitest'

import {
  REFRESH_AT,
  TOKEN_SCOPES,
  TOKEN_TTL_S,
  mapboxConfig,
  mintTemporaryToken,
  needsRefresh,
} from '../src/lib/mapboxToken.js'

/**
 * Short-lived Mapbox tokens.
 *
 * The public token in the bundle is URL-restricted to our own hosts, so a white-label tenant's
 * dashboard — served from THEIR domain — got 403 on every tile and rendered a black rectangle
 * under a working interface. A token that expires in an hour needs no allow-list at all.
 */
describe('mapboxConfig', () => {
  it('needs both a username and a secret before it will claim to be configured', () => {
    expect(mapboxConfig({ MAPBOX_USERNAME: 'acme', MAPBOX_SECRET_TOKEN: 'sk.x' })).toEqual({
      username: 'acme',
      secretToken: 'sk.x',
    })
    expect(mapboxConfig({ MAPBOX_USERNAME: 'acme' })).toBeNull()
    expect(mapboxConfig({ MAPBOX_SECRET_TOKEN: 'sk.x' })).toBeNull()
    expect(mapboxConfig({})).toBeNull()
  })

  it('treats blank and whitespace-only values as unset', () => {
    // a compose file with `MAPBOX_USERNAME=` sets the variable to an empty string, which is not
    // configuration — minting with it would 404 on every call and take the map down for everyone
    expect(mapboxConfig({ MAPBOX_USERNAME: '', MAPBOX_SECRET_TOKEN: 'sk.x' })).toBeNull()
    expect(mapboxConfig({ MAPBOX_USERNAME: '  ', MAPBOX_SECRET_TOKEN: 'sk.x' })).toBeNull()
  })
})

/** `RequestInit['body']` is a union of streams and blobs; only ours is a string, so say so. */
const bodyText = (init: RequestInit | undefined): string => (typeof init?.body === 'string' ? init.body : '')
const urlText = (url: string | URL | Request): string => (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url)

describe('mintTemporaryToken', () => {
  const cfg = { username: 'acme', secretToken: 'sk.secret' }
  const NOW = Date.parse('2026-09-06T10:00:00.000Z')

  it('asks Mapbox for a token that expires within the hour, read-only', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(bodyText(init)) as { expires: string; scopes: string[] }
      // one hour exactly — Mapbox refuses anything longer for a temporary token
      expect(Date.parse(body.expires) - NOW).toBe(TOKEN_TTL_S * 1000)
      // nothing that can write. This token is handed to every browser session.
      expect(body.scopes).toEqual([...TOKEN_SCOPES])
      expect(body.scopes.some((s) => s.includes(':write'))).toBe(false)
      return Promise.resolve(new Response(JSON.stringify({ token: 'tk.temporary' }), { status: 200 }))
    })
    const out = await mintTemporaryToken(fetchImpl, cfg, NOW)
    expect(out.token).toBe('tk.temporary')
    expect(Date.parse(out.expiresAt)).toBe(NOW + TOKEN_TTL_S * 1000)
  })

  it('sends the secret as the credential and never in the body', async () => {
    const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      expect(urlText(url)).toContain('access_token=sk.secret')
      expect(bodyText(init)).not.toContain('sk.secret')
      return Promise.resolve(new Response(JSON.stringify({ token: 'tk.x' }), { status: 200 }))
    })
    await mintTemporaryToken(fetchImpl, cfg, NOW)
  })

  it('throws on a refusal rather than returning something unusable', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('nope', { status: 401 })))
    await expect(mintTemporaryToken(fetchImpl as typeof fetch, cfg, NOW)).rejects.toThrow(/401/)
  })

  it('throws when the response carries no token — a 200 is not the same as a result', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))
    await expect(mintTemporaryToken(fetchImpl as typeof fetch, cfg, NOW)).rejects.toThrow(/no token/)
  })
})

describe('needsRefresh', () => {
  const NOW = Date.parse('2026-09-06T10:00:00.000Z')
  const minted = (atMs: number) => ({ token: 't', expiresAt: new Date(atMs + TOKEN_TTL_S * 1000).toISOString() })

  it('mints when there is nothing cached', () => {
    expect(needsRefresh(null, NOW)).toBe(true)
  })

  it('keeps a fresh token rather than asking Mapbox on every page load', () => {
    // token creation is rate-limited; a mint per request takes the map out for everyone at once
    expect(needsRefresh(minted(NOW), NOW + 60_000)).toBe(false)
  })

  it('re-mints before expiry, not at it', () => {
    const justBefore = TOKEN_TTL_S * 1000 * REFRESH_AT - 1_000
    expect(needsRefresh(minted(NOW), NOW + justBefore)).toBe(false)
    expect(needsRefresh(minted(NOW), NOW + justBefore + 2_000)).toBe(true)
    // a token that dies mid-pan turns the map black with no action to explain it
    expect(needsRefresh(minted(NOW), NOW + TOKEN_TTL_S * 1000)).toBe(true)
  })

  it('re-mints rather than trusting an unparseable expiry', () => {
    expect(needsRefresh({ token: 't', expiresAt: 'soon' }, NOW)).toBe(true)
  })
})
