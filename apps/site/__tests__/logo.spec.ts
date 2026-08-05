import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The mark exists in three places — this component, `public/orbetra-logo.svg`, and `apps/web`'s copy
 * of the same file — and nothing connected them, so they drifted: the public pages drew the previous
 * mark (a different geometry in `#5653E7`) while the favicon, the wordmark and the app all showed
 * the current one. It is the single most-seen element on the site, and the only way anyone noticed
 * was by looking at it.
 */
const read = (p: string): string => readFileSync(resolve(import.meta.dirname, '..', p), 'utf8')

/** Every `d="…"` in the order it appears — the geometry, independent of formatting or attributes. */
const paths = (svg: string): string[] => [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => (m[1] ?? '').trim())
const fills = (svg: string): string[] => [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => (m[1] ?? '').toUpperCase())
const viewBox = (svg: string): string | undefined => /viewBox="([^"]+)"/.exec(svg)?.[1]

describe('the Orbetra mark is one mark', () => {
  const component = read('src/components/site/OrbetraLogo.tsx')
  const file = read('public/orbetra-logo.svg')

  it('the inline component draws the SAME geometry as public/orbetra-logo.svg', () => {
    expect(paths(component)).toEqual(paths(file))
    expect(viewBox(component)).toBe(viewBox(file))
  })

  it('…in the same brand colour, and the favicon agrees', () => {
    expect(new Set(fills(component))).toEqual(new Set(fills(file)))
    // the favicon carries its fill in a <style> block (it swaps to white in dark mode), so match the
    // light-mode declaration rather than a fill attribute
    const favicon = read('public/favicon.svg')
    expect(favicon).toContain(fills(file)[0] ?? '')
    expect(paths(favicon)).toEqual(paths(file))
  })

  it('the wordmark carries the same brand colour (it also has an ink colour for the letters)', () => {
    expect(fills(read('public/orbetra-wordmark.svg'))).toContain(fills(file)[0] ?? '')
  })

  it('apps/web serves a byte-identical logo — one asset, two apps', () => {
    expect(read('../web/public/orbetra-logo.svg')).toBe(file)
  })
})
