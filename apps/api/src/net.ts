/**
 * Client IP for rate-limit/lockout keying. With trustProxy, use the RIGHTMOST XFF entry —
 * the one appended by our own nearest trusted proxy (Caddy) — NOT the leftmost, which is
 * client-controlled and spoofable (would let an attacker mint a fresh bucket per request).
 * Without trustProxy, the socket peer. Assumes exactly one trusted proxy in front.
 *
 * The result is BUCKETED, not verbatim — see `ipBucket`. Everything that calls this uses it as a
 * rate-limit key, and a per-address key is not a per-attacker key.
 */
export function clientIp(headerXff: string | undefined, remoteAddr: string, trustProxy: boolean): string {
  if (trustProxy && headerXff) {
    const parts = headerXff.split(',').map((p) => p.trim()).filter((p) => p !== '')
    if (parts.length > 0) return ipBucket(parts[parts.length - 1]!)
  }
  return ipBucket(remoteAddr)
}

/**
 * The unit every per-source limit is counted against: an IPv4 address as-is, an IPv6 address
 * collapsed to its 64-bit prefix.
 *
 * Keying IPv6 verbatim makes every per-source ceiling meaningless. A /64 is the smallest block any
 * ISP or VPS hands out — one machine, 2^64 addresses — so an attacker on a single host gets a fresh
 * empty bucket for every request: the per-(IP,email) rule, the per-IP failure and attempt ceilings,
 * and the account's distinct-source count all reset each time. The lockout that is supposed to cost
 * a botnet of 30 distinct hosts costs one, and the CPU shed sheds nothing. Worse, the ceilings then
 * bind only on people who genuinely SHARE an address — offices and carrier NAT — so the controls
 * land precisely on the legitimate traffic and miss the attack.
 *
 * /64 is the right granularity in both directions: it is what a single subscriber is delegated, and
 * it never merges two customers the way a shorter prefix would.
 */
export function ipBucket(addr: string): string {
  // `[2001:db8::1]:443` — the bracketed authority form. Nothing in the deployed topology hands us
  // one (Caddy appends a bare host), but a bracket that survived into a key would silently be a
  // SECOND bucket for the same client.
  const unbracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(addr.trim())
  const a = (unbracketed?.[1] ?? addr).split('%')[0]!.trim().toLowerCase() // drop any zone id
  if (!a.includes(':')) return a // IPv4, or something we do not recognise: key it verbatim

  const halves = a.split('::')
  if (halves.length > 2) return a // malformed — never guess at a key that gates authentication
  const split = (part: string | undefined): string[] =>
    part === undefined || part === '' ? [] : part.split(':').filter((g) => g !== '')
  const left = split(halves[0])
  const right = halves.length === 2 ? split(halves[1]) : []
  // a dotted tail (::ffff:203.0.113.7, ::203.0.113.7) is the last TWO groups written as IPv4
  const tail = [...left, ...right].filter((g) => g.includes('.'))
  if (tail.length > 1) return a
  let dotted: string | null = null
  if (tail.length === 1) {
    const quad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(tail[0]!)
    if (quad === null || quad.slice(1).some((n) => Number(n) > 255)) return a
    dotted = tail[0]!
  }
  const flat = [...left, ...right].filter((g) => !g.includes('.'))
  if (flat.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return a // not an address we understand
  const explicit = flat.length + (dotted !== null ? 2 : 0)
  const groups =
    halves.length === 2
      ? [
          ...left.filter((g) => !g.includes('.')),
          ...Array<string>(Math.max(0, 8 - explicit)).fill('0'),
          ...right.filter((g) => !g.includes('.')),
        ]
      : flat
  const dottedGroups =
    dotted === null
      ? []
      : (() => {
          const [b1, b2, b3, b4] = dotted.split('.').map(Number) as [number, number, number, number]
          return [((b1 << 8) | b2).toString(16), ((b3 << 8) | b4).toString(16)]
        })()
  const full = [...groups, ...dottedGroups]
  if (full.length !== 8) return a
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) are an IPv4 client on a dual-stack
  // socket. Decided on the PARSED 96-bit prefix, not on the textual form: `::ffff:203.0.113.7` and
  // `::ffff:cb00:7107` are the same address, and keying them apart hands one client two budgets.
  const prefixZero = full.slice(0, 5).every((g) => Number.parseInt(g, 16) === 0)
  if (prefixZero && Number.parseInt(full[5]!, 16) === 0xffff) {
    const hi = Number.parseInt(full[6]!, 16)
    const lo = Number.parseInt(full[7]!, 16)
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  }
  // strip leading zeros so 2001:0db8:… and 2001:db8:… are one bucket, not two
  return `${full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`
}
