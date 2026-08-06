import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assertPublicUrl } from '../src/webhook/guard.js'
import { deliverWebhook } from '../src/webhook/deliver.js'

/**
 * Webhook delivery pins the connection to the address the SSRF guard validated (ADR-035).
 *
 * The attacker is a tenant admin: they set the webhook URL and they control its DNS record. Handing
 * the hostname to `fetch` after checking it let undici resolve a SECOND time, so `attacker.example`
 * could answer publicly for the check and `169.254.169.254` for the connection a millisecond later —
 * and delivery runs inside the compose network. These tests drive a real HTTP server, because the
 * property under test is which socket is opened, not which function was called.
 */
let server: Server
let port: number
const seen: { host: string | undefined; path: string; body: string; auth: string | undefined }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += String(c)))
    req.on('end', () => {
      seen.push({ host: req.headers.host, path: req.url ?? '', body, auth: req.headers['x-signature'] as string | undefined })
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
        res.end()
        return
      }
      if (req.url === '/boom') {
        res.writeHead(500)
        res.end('no')
        return
      }
      if (req.url === '/hang') return // never responds — the timeout must bound it
      res.writeHead(204)
      res.end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as { port: number }).port
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

const opts = (path: string, host = 'hook.example') => ({
  url: new URL(`http://${host}:${port}${path}`),
  ip: '127.0.0.1',
  headers: { 'content-type': 'application/json', 'X-Signature': 'sig' },
  body: JSON.stringify({ kind: 'panic' }),
  timeoutMs: 2_000,
})

describe('deliverWebhook', () => {
  it('dials the pinned IP while presenting the ORIGINAL hostname', async () => {
    // the socket goes to 127.0.0.1 (the validated address) but the endpoint must still see the name
    // the tenant configured — virtual hosts and Host-routing endpoints depend on it
    seen.length = 0
    const res = await deliverWebhook(opts('/hook'))
    expect(res).toEqual({ status: 204, ok: true })
    expect(seen[0]?.host).toBe(`hook.example:${port}`)
    expect(seen[0]?.path).toBe('/hook')
    expect(seen[0]?.auth).toBe('sig')
    expect(seen[0]?.body).toBe(JSON.stringify({ kind: 'panic' }))
  })

  it('keeps the query string — a webhook URL may carry a token in it', async () => {
    seen.length = 0
    await deliverWebhook(opts('/hook?t=abc123'))
    expect(seen[0]?.path).toBe('/hook?t=abc123')
  })

  it('REFUSES a redirect instead of following it into the metadata service', async () => {
    // following would resolve a NEW host and undo the pinning entirely — this is the same
    // escalation by another route, which is why it is an error rather than a hop
    await expect(deliverWebhook(opts('/redirect'))).rejects.toThrow(/redirect refused/)
  })

  it('reports a non-2xx as not-ok rather than throwing — the caller decides what retries', async () => {
    expect(await deliverWebhook(opts('/boom'))).toEqual({ status: 500, ok: false })
  })

  it('bounds a hanging endpoint — `timeout` alone does not abort a node request', async () => {
    await expect(deliverWebhook({ ...opts('/hang'), timeoutMs: 300 })).rejects.toThrow(/timeout/)
  })

  it('a connection refused surfaces as an error, not a hang', async () => {
    await expect(deliverWebhook({ ...opts('/hook'), ip: '127.0.0.1', url: new URL('http://hook.example:1/x') })).rejects.toThrow()
  })
})

describe('assertPublicUrl returns the address it validated', () => {
  it('hands back the ip so the caller never has to resolve again — that second resolution IS the bug', async () => {
    const v = await assertPublicUrl('https://hook.example/x', (() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])) as never)
    expect(v.ip).toBe('93.184.216.34')
    expect(v.url.toString()).toBe('https://hook.example/x')
  })

  it('refuses when ANY answer is private — a mixed round-robin is the attacker’s choice, not ours', async () => {
    const mixed = (() => Promise.resolve([{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }])) as never
    await expect(assertPublicUrl('https://hook.example/x', mixed)).rejects.toThrow(/private address/)
  })

  it('an IP literal is validated and pinned as itself', async () => {
    expect((await assertPublicUrl('http://93.184.216.34/x')).ip).toBe('93.184.216.34')
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/private/)
  })
})
