/**
 * Client IP for rate-limit/lockout keying. With trustProxy, use the RIGHTMOST XFF entry —
 * the one appended by our own nearest trusted proxy (Caddy) — NOT the leftmost, which is
 * client-controlled and spoofable (would let an attacker mint a fresh bucket per request).
 * Without trustProxy, the socket peer. Assumes exactly one trusted proxy in front.
 */
export function clientIp(headerXff: string | undefined, remoteAddr: string, trustProxy: boolean): string {
  if (trustProxy && headerXff) {
    const parts = headerXff.split(',').map((p) => p.trim()).filter((p) => p !== '')
    if (parts.length > 0) return parts[parts.length - 1]!
  }
  return remoteAddr
}
