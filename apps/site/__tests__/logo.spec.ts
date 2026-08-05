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

/** The source of ONE exported component — the file holds several, and each mirrors its own asset. */
const componentSource = (src: string, name: string): string => {
  const start = src.indexOf(`export function ${name}(`)
  if (start === -1) throw new Error(`no component ${name}`)
  const next = src.indexOf('export function ', start + 1)
  return src.slice(start, next === -1 ? undefined : next)
}

describe('the Orbetra logo is one logo', () => {
  const src = read('src/components/site/OrbetraLogo.tsx')
  const component = componentSource(src, 'OrbetraMark')
  const file = read('public/orbetra-logo.svg')

  it('the inline MARK draws the same geometry as public/orbetra-logo.svg', () => {
    expect(paths(component)).toEqual(paths(file))
    expect(viewBox(component)).toBe(viewBox(file))
  })

  it('the inline WORDMARK draws the same geometry as public/orbetra-wordmark.svg', () => {
    // the real lockup: the circle mark IS the "O". The nav bar used to draw the mark next to a
    // separate <span>Orbetra</span>, so the O appeared twice and it was not the logo at all.
    const wm = componentSource(src, 'OrbetraWordmark')
    const wmFile = read('public/orbetra-wordmark.svg')
    expect(paths(wm)).toEqual(paths(wmFile))
    expect(viewBox(wm)).toBe(viewBox(wmFile))
  })

  it('the wordmark is ONE evenodd path — its counters must be holes, not painted shapes', () => {
    // the vendor export drew each counter as a separate path filled with the export canvas colour,
    // so on a light background the bowls of b/e/a/o rendered as solid navy blobs
    const wmFile = read('public/orbetra-wordmark.svg')
    expect(paths(wmFile)).toHaveLength(1)
    expect(wmFile).toMatch(/fill-rule="evenodd"/)
    expect(fills(wmFile)).toEqual(['#5253DA'])
    expect(componentSource(src, 'OrbetraWordmark')).toMatch(/fillRule="evenodd"/)
  })

  it('…in the same brand colour, and the favicon agrees', () => {
    expect(new Set(fills(component))).toEqual(new Set(fills(file)))
    // the favicon carries its fill in a <style> block (it swaps to white in dark mode), so match the
    // light-mode declaration rather than a fill attribute
    const favicon = read('public/favicon.svg')
    expect(favicon).toContain(fills(file)[0] ?? '')
    expect(paths(favicon)).toEqual(paths(file))
  })

  it('the wordmark carries the same brand colour', () => {
    expect(fills(read('public/orbetra-wordmark.svg'))).toContain(fills(file)[0] ?? '')
  })

  it('apps/web serves a byte-identical wordmark too — one asset, two apps', () => {
    expect(read('../web/public/orbetra-wordmark.svg')).toBe(read('public/orbetra-wordmark.svg'))
  })

  it('apps/web serves a byte-identical logo — one asset, two apps', () => {
    expect(read('../web/public/orbetra-logo.svg')).toBe(file)
  })
})
