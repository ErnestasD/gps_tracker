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
  const a = addr.split('%')[0]!.trim().toLowerCase() // drop any zone id (fe80::1%eth0)
  // IPv4-mapped IPv6 (::ffff:203.0.113.7) is an IPv4 client arriving on a dual-stack socket
  const mapped = /^(?:::ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a)
  if (mapped !== null) return mapped[1]!
  if (!a.includes(':')) return a // IPv4, or something we do not recognise: key it verbatim
  const halves = a.split('::')
  if (halves.length > 2) return a // malformed — never guess at a key that gates authentication
  const left = halves[0] === '' ? [] : halves[0]!.split(':').filter((g) => g !== '')
  const right = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':').filter((g) => g !== '')) : []
  if ([...left, ...right].some((g) => g.includes('.'))) return a // embedded IPv4 form; leave it alone
  const groups =
    halves.length === 2
      ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
      : left
  if (groups.length < 4) return a
  // strip leading zeros so 2001:0db8:… and 2001:db8:… are one bucket, not two
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`
}
