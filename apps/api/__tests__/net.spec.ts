import { describe, expect, it } from 'vitest'

import { clientIp, ipBucket } from '../src/net.js'

/**
 * The keying unit for every per-source limit on the platform: login lockouts, signup, password
 * reset, the pilot form, the Caddy on-demand-TLS ask. Getting it wrong does not fail loudly — the
 * limits simply stop binding on the traffic they were written for, and start binding only on the
 * traffic they were not.
 */
describe('ipBucket', () => {
  it('collapses IPv6 to /64 — a per-ADDRESS key is not a per-attacker key', () => {
    // REGRESSION (audit review). A /64 is the smallest block any ISP or VPS delegates: one machine,
    // 2^64 addresses. Keyed verbatim, a single host got a fresh empty bucket for every request, so
    // the per-(IP,email) rule, both per-IP ceilings and the account's distinct-source count all
    // reset each time — the lockout meant to cost a 30-host botnet cost one host, and the CPU shed
    // shed nothing. Meanwhile the ceilings still bound offices and carrier NAT, who do share one
    // address: the controls landed on exactly the wrong population.
    const one = ipBucket('2001:db8:1234:5678::1')
    expect(one).toBe('2001:db8:1234:5678::/64')
    for (const sibling of ['2001:db8:1234:5678::2', '2001:db8:1234:5678:ffff:ffff:ffff:ffff', '2001:0db8:1234:5678:9::2']) {
      expect(ipBucket(sibling), `${sibling} must share a bucket with the /64`).toBe(one)
    }
    // a DIFFERENT /64 is a different bucket — the aggregation must not merge two subscribers
    expect(ipBucket('2001:db8:1234:5679::1')).not.toBe(one)
  })

  it('leaves IPv4 alone and unwraps the IPv4-mapped form (dual-stack sockets)', () => {
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7')
    // ::ffff:203.0.113.7 is an IPv4 client on a dual-stack listener — the same host, so the same
    // bucket, or it would get a second budget just by connecting differently
    expect(ipBucket('::ffff:203.0.113.7')).toBe('203.0.113.7')
  })

  it('never invents a key it cannot justify: zone ids stripped, malformed input passed through', () => {
    expect(ipBucket('fe80::1%eth0')).toBe(ipBucket('fe80::2'))
    // authentication gates on this value — an unrecognised shape is keyed verbatim rather than
    // guessed at, which is the conservative direction (one bucket per odd string, never a merge)
    expect(ipBucket('not-an-ip')).toBe('not-an-ip')
    expect(ipBucket('1:2::3::4')).toBe('1:2::3::4')
  })

  it('buckets the RIGHTMOST XFF entry — the one our own proxy appended', () => {
    // the leftmost entries are attacker-controlled; trusting them would hand out a fresh bucket per
    // request through a header, which is the same defeat as the IPv6 one by another route
    expect(clientIp('2001:db8:aaaa:1::9, 2001:db8:bbbb:2::7', '10.0.0.1', true)).toBe('2001:db8:bbbb:2::/64')
    expect(clientIp('2001:db8:aaaa:1::9', '2001:db8:cccc:3::4', false)).toBe('2001:db8:cccc:3::/64')
    expect(clientIp(undefined, '203.0.113.7', true)).toBe('203.0.113.7')
  })
})
