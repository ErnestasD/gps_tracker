import { describe, expect, it } from 'vitest'

import { assertPublicUrl, isPrivateIp, UnsafeUrlError } from '../src/webhook/guard.js'

describe('E06-4 isPrivateIp', () => {
  it('flags loopback / link-local / private / ULA / CGNAT', () => {
    for (const ip of ['127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:10.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })
  it('allows genuine public addresses', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })
  it('treats an unparseable address as unsafe', () => {
    expect(isPrivateIp('not-an-ip')).toBe(true)
  })
})

const pub = () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]) as never
const priv = () => Promise.resolve([{ address: '10.0.0.5', family: 4 }]) as never

describe('E06-4 assertPublicUrl', () => {
  it('accepts an http(s) URL resolving to a public IP', async () => {
    await expect(assertPublicUrl('https://example.test/hook', pub)).resolves.toBeInstanceOf(URL)
  })
  it('rejects a non-http scheme', async () => {
    await expect(assertPublicUrl('file:///etc/passwd', pub)).rejects.toBeInstanceOf(UnsafeUrlError)
    await expect(assertPublicUrl('gopher://x/', pub)).rejects.toBeInstanceOf(UnsafeUrlError)
  })
  it('rejects a literal private-IP host without DNS', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/', pub)).rejects.toThrow(/private/)
    await expect(assertPublicUrl('http://[::1]:6379/', pub)).rejects.toThrow(/private/)
  })
  it('rejects a public host that resolves to a private IP (rebinding defense)', async () => {
    await expect(assertPublicUrl('https://sneaky.test/x', priv)).rejects.toThrow(/private/)
  })
  it('rejects a malformed URL', async () => {
    await expect(assertPublicUrl('http://', pub)).rejects.toBeInstanceOf(UnsafeUrlError)
  })
})
