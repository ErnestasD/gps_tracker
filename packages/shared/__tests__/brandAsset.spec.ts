import { describe, expect, it } from 'vitest'

import {
  MAX_BRAND_ASSET_BYTES,
  absolutizeBrandAssets,
  assetPath,
  inspectBrandAsset,
  isBrandAssetPath,
  parseAssetPath,
  sniffPng,
  validateSvg,
} from '../src/brandAsset.js'
import { brandingSchema } from '../src/entities.js'

/** A PNG header with the given IHDR dimensions — enough for every check that reads the file. */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([0, 0, 0, 13], 8)
  b.set([0x49, 0x48, 0x44, 0x52], 12) // 'IHDR'
  const dv = new DataView(b.buffer)
  dv.setUint32(16, w)
  dv.setUint32(20, h)
  return b
}
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const SHA = 'a'.repeat(64)

describe('brand asset paths', () => {
  it('is a content address, so replacing an image changes the URL', () => {
    expect(assetPath(SHA, 'image/png')).toBe(`/v1/public/brand/${'a'.repeat(32)}.png`)
    expect(assetPath('b'.repeat(64), 'image/png')).not.toBe(assetPath(SHA, 'image/png'))
    expect(assetPath(SHA, 'image/svg+xml')).toBe(`/v1/public/brand/${'a'.repeat(32)}.svg`)
  })

  it('round-trips, and refuses anything that is not one of ours', () => {
    expect(parseAssetPath(assetPath(SHA, 'image/svg+xml'))).toEqual({ hash: 'a'.repeat(32), mime: 'image/svg+xml' })
    for (const bad of [
      '/v1/public/brand/../../etc/passwd',
      '/v1/public/brand/NOTHEX0000000000000000000000000.png',
      `/v1/public/brand/${'a'.repeat(31)}.png`, // one short
      `/v1/public/brand/${'a'.repeat(32)}.gif`,
      `/v1/public/brand/${'a'.repeat(32)}`,
      'https://evil.example/x.png',
    ]) {
      expect(parseAssetPath(bad), bad).toBeNull()
      expect(isBrandAssetPath(bad), bad).toBe(false)
    }
  })
})

describe('PNG sniffing — the bytes decide, not the uploader', () => {
  it('reads real IHDR dimensions', () => {
    expect(sniffPng(png(192, 192))).toEqual({ width: 192, height: 192 })
    expect(sniffPng(png(1, 1))).toEqual({ width: 1, height: 1 })
  })

  it('rejects a non-PNG, a truncated header, and a zero dimension', () => {
    expect(sniffPng(utf8('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffPng(png(10, 10).slice(0, 20))).toBeNull()
    expect(sniffPng(png(0, 10))).toBeNull()
  })

  it('rejects the right magic bytes with the wrong first chunk', () => {
    const b = png(10, 10)
    b.set([0x49, 0x44, 0x41, 0x54], 12) // 'IDAT' where IHDR must be
    expect(sniffPng(b)).toBeNull()
  })
})

describe('SVG screening (second layer — the sandbox CSP is the first)', () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123456"/></svg>'

  it('passes an ordinary logo, including one with a DOCTYPE but no internal subset', () => {
    expect(validateSvg(ok)).toBeNull()
    expect(validateSvg(`<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${ok}`)).toBeNull()
  })

  it('names the reason for each hostile construct', () => {
    const cases: [string, string][] = [
      ['<svg><script>alert(1)</script></svg>', 'script'],
      ['<svg onload="alert(1)"></svg>', 'event_handler'],
      ['<svg><a href="javascript:alert(1)">x</a></svg>', 'javascript_url'],
      ['<svg><foreignObject><body/></foreignObject></svg>', 'foreign_object'],
      ['<svg><iframe src="x"/></svg>', 'embedded_content'],
      ['<!DOCTYPE svg [<!ENTITY a "b">]><svg/>', 'doctype_subset'],
      ['<svg><use href="https://evil.example/x.svg#a"/></svg>', 'remote_reference'],
      ['<svg><image xlink:href="//evil.example/x.png"/></svg>', 'remote_reference'],
      ['not markup at all', 'not_svg'],
    ]
    for (const [src, reason] of cases) expect(validateSvg(src), src).toBe(reason)
  })
})

describe('inspectBrandAsset — one accept/reject decision for server and browser', () => {
  it('accepts a PNG and reports its size', () => {
    expect(inspectBrandAsset(png(192, 192), 'image/png')).toEqual({ ok: true, value: { mime: 'image/png', width: 192, height: 192 } })
  })

  it('accepts an SVG with no dimensions — it has none to report', () => {
    const r = inspectBrandAsset(utf8('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')
    expect(r).toEqual({ ok: true, value: { mime: 'image/svg+xml', width: null, height: null } })
  })

  it('catches a lying mime in BOTH directions', () => {
    // SVG markup declared as PNG: fails the magic bytes.
    expect(inspectBrandAsset(utf8('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png')).toEqual({ ok: false, reason: 'mime_mismatch' })
    // PNG bytes declared as SVG: fails the `<svg` check, which is the same protection by another name.
    expect(inspectBrandAsset(png(8, 8), 'image/svg+xml')).toEqual({ ok: false, reason: 'not_svg' })
  })

  it('bounds both the byte count and the pixel count — a small file can still be a huge image', () => {
    expect(inspectBrandAsset(new Uint8Array(0), 'image/png')).toEqual({ ok: false, reason: 'empty' })
    const big = new Uint8Array(MAX_BRAND_ASSET_BYTES + 1)
    big.set(png(8, 8), 0)
    expect(inspectBrandAsset(big, 'image/png')).toEqual({ ok: false, reason: 'too_large' })
    // 24 bytes on the wire, 20000×20000 in the decoder.
    expect(inspectBrandAsset(png(20_000, 20_000), 'image/png')).toEqual({ ok: false, reason: 'too_many_pixels' })
  })
})

describe('brandingSchema accepts an upload path OR an https URL, and nothing else', () => {
  const path = assetPath(SHA, 'image/png')

  it('takes both forms for logo and favicon', () => {
    expect(brandingSchema.safeParse({ logoUrl: path, faviconUrl: 'https://cdn.example/i.png' }).success).toBe(true)
    expect(brandingSchema.safeParse({ logoUrl: 'https://cdn.example/l.svg', faviconUrl: path }).success).toBe(true)
  })

  it('still refuses http and anything that is not a path we serve', () => {
    for (const bad of ['http://cdn.example/i.png', 'javascript:alert(1)', '/v1/public/brand/../secret.png', '/etc/passwd']) {
      expect(brandingSchema.safeParse({ logoUrl: bad }).success, bad).toBe(false)
    }
  })
})

describe('absolutizeBrandAssets — email is the one reader with no page to resolve against', () => {
  const path = assetPath(SHA, 'image/png')

  it('stamps the tenant origin on uploaded paths only', () => {
    expect(absolutizeBrandAssets({ logoUrl: path, faviconUrl: 'https://cdn.example/f.png' }, 'https://track.klientas.lt')).toEqual({
      logoUrl: `https://track.klientas.lt${path}`,
      faviconUrl: 'https://cdn.example/f.png',
    })
  })

  it('tolerates a trailing slash on the origin rather than producing a double one', () => {
    expect(absolutizeBrandAssets({ logoUrl: path }, 'https://track.klientas.lt/').logoUrl).toBe(`https://track.klientas.lt${path}`)
  })

  it('leaves everything alone when no origin is known — a missing logo, never a broken one', () => {
    const b = { logoUrl: path, primary: '#112233' }
    expect(absolutizeBrandAssets(b, null)).toEqual(b)
  })

  it('preserves the other branding keys, so the object stays a whole brand', () => {
    const out = absolutizeBrandAssets({ logoUrl: path, productName: 'VrummTrack', primary: '#112233' }, 'https://x.lt')
    expect(out.productName).toBe('VrummTrack')
    expect(out.primary).toBe('#112233')
  })
})
