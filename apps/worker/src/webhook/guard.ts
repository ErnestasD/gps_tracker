import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * SSRF guard for webhook delivery (E06-4 review HIGH). A webhook URL is set by a tenant admin
 * but delivery runs INSIDE the compose/prod network with DB/Redis/api/cloud-metadata
 * reachable, so an unrestricted POST is a private→infra escalation. We (1) allow only
 * http/https, (2) resolve the host at REQUEST time (defeats DNS rebinding — a public name that
 * later resolves to a private IP) and reject loopback/link-local/private/ULA/metadata targets.
 * The caller must ALSO pass `redirect: 'error'` to fetch so a public URL can't 302 into a
 * private one. No new dependency — node:dns + node:net only.
 */
export class UnsafeUrlError extends Error {
  constructor(reason: string) {
    super(`unsafe webhook url: ${reason}`)
    this.name = 'UnsafeUrlError'
  }
}

/** Parse + validate the URL and resolve its host to only public IPs, or throw. */
export async function assertPublicUrl(raw: string, resolveHost: typeof lookup = lookup): Promise<URL> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new UnsafeUrlError('malformed')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError(`scheme ${u.protocol}`)

  const host = u.hostname.replace(/^\[|\]$/g, '') // strip IPv6 brackets
  const ips = isIP(host) ? [host] : (await resolveHost(host, { all: true })).map((r) => r.address)
  if (ips.length === 0) throw new UnsafeUrlError('no address')
  for (const ip of ips) if (isPrivateIp(ip)) throw new UnsafeUrlError(`private address ${ip}`)
  return u
}

/** True for loopback / link-local / private / ULA / CGNAT / reserved addresses. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return isPrivateV4(ip)
  if (v === 6) return isPrivateV6(ip)
  return true // not a parseable IP ⇒ treat as unsafe
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true
  const [a, b] = p as [number, number, number, number]
  if (a === 0 || a === 127 || a >= 224) return true // this-net, loopback, multicast/reserved
  if (a === 10) return true
  if (a === 169 && b === 254) return true // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return false
}

function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase()
  if (s === '::1' || s === '::') return true // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) → check the embedded v4
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (mapped) return isPrivateV4(mapped[1]!)
  const head = s.split(':')[0] ?? ''
  if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) return true // fe80::/10 link-local
  if (head.startsWith('fc') || head.startsWith('fd')) return true // fc00::/7 unique-local
  return false
}
