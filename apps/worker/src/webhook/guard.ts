import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * SSRF guard for webhook delivery (E06-4 review HIGH). A webhook URL is set by a tenant admin
 * but delivery runs INSIDE the compose/prod network with DB/Redis/api/cloud-metadata
 * reachable, so an unrestricted POST is a private→infra escalation. We (1) allow only
 * http/https, (2) resolve the host at REQUEST time and reject loopback/link-local/private/ULA/
 * CGNAT/metadata targets — including IPv4-mapped IPv6 in the hex-compressed form `new URL()`
 * normalizes to (e.g. [::ffff:169.254.169.254] → ::ffff:a9fe:a9fe) and NAT64.
 * The caller must ALSO pass `redirect: 'error'` to fetch so a public URL can't 302 into a
 * private one. No new dependency — node:dns + node:net only.
 *
 * RESIDUAL GAP (TOCTOU / DNS rebinding, review HIGH — NOT fixed here): undici (node fetch)
 * re-resolves the hostname at connect time, so a record that changes between this lookup and
 * undici's, or a multi-A round-robin, can still land on a private IP. Fully closing it requires
 * pinning the connection to the validated IP via a custom undici dispatcher — a new runtime dep
 * that needs an ADR (rule 10). TODO(ADR): pin the resolved address at connect time.
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

/**
 * Expand any IPv6 literal (compressed `::`, embedded dotted-quad, hex-mapped) to its 16 bytes,
 * or null if unparseable. Needed because `new URL()` normalizes a bracketed literal to the
 * HEX-compressed form — e.g. `[::ffff:127.0.0.1]` → `::ffff:7f00:1` — which a dotted-decimal
 * regex never matches (SSRF guard bypass, review HIGH).
 */
function v6ToBytes(ip: string): number[] | null {
  let s = ip
  // embedded dotted IPv4 (e.g. ::ffff:1.2.3.4) → fold the trailing quad into two hextets
  const dotted = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s)
  if (dotted) {
    const q = dotted[2]!.split('.').map(Number)
    if (q.length !== 4 || q.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null
    s = `${dotted[1]!}${(((q[0]! << 8) | q[1]!) >>> 0).toString(16)}:${(((q[2]! << 8) | q[3]!) >>> 0).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const hasGap = halves.length === 2
  const tail = hasGap ? (halves[1] ? halves[1].split(':') : []) : []
  let groups: string[]
  if (!hasGap) {
    groups = head
  } else {
    const missing = 8 - head.length - tail.length
    if (missing < 0) return null
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail]
  }
  if (groups.length !== 8) return null
  const bytes: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    const n = parseInt(g, 16)
    bytes.push((n >> 8) & 0xff, n & 0xff)
  }
  return bytes
}

function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase()
  if (s === '::1' || s === '::') return true // loopback / unspecified
  const b = v6ToBytes(s)
  if (b === null) return true // unparseable ⇒ treat as unsafe
  const embeddedV4 = (): string => b.slice(12).join('.')
  const zeroHi = (n: number): boolean => b.slice(0, n).every((x) => x === 0)
  // IPv4-mapped ::ffff:0:0/96 (dotted OR hex form) → judge by the embedded IPv4
  if (zeroHi(10) && b[10] === 0xff && b[11] === 0xff) return isPrivateV4(embeddedV4())
  // NAT64 well-known prefix 64:ff9b::/96 → embedded IPv4 is the real destination
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) return isPrivateV4(embeddedV4())
  // deprecated IPv4-compatible ::a.b.c.d (high 96 bits zero) → judge by the embedded IPv4
  if (zeroHi(12)) return isPrivateV4(embeddedV4())
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true // fe80::/10 link-local
  if ((b[0]! & 0xfe) === 0xfc) return true // fc00::/7 unique-local (fc00/fd00)
  return false
}
