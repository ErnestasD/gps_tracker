import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { KB, type KbSlug } from '@orbetra/kb'
import { KB_ARTICLES } from '@orbetra/kb/content'

/**
 * The gap the content package cannot close on its own.
 *
 * A contextual help link may target a HEADING inside an article — `<HelpLink slug={KB.customDomain}
 * anchor="dns-dot" />` — and nothing connects the two sides at compile time: the anchor is a plain
 * string here and an authored `id` over there. Rename the heading's id and the link still renders,
 * still navigates, and simply lands at the top of the page instead of the paragraph that answers
 * the question. Silent, and exactly the kind of rot a knowledge base accumulates.
 *
 * packages/kb asserts anchors are consistent ACROSS LANGUAGES; only this app knows which ones it
 * points at.
 */
const SRC = resolve(import.meta.dirname, '../src')

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) return tsFiles(p)
    return /\.tsx?$/.test(p) ? [p] : []
  })
}

/** The block ids of an article, in English (packages/kb proves every language matches). */
function anchorsOf(slug: string): Set<string> {
  const article = KB_ARTICLES.find((a) => a.slug === slug)
  if (article === undefined) return new Set()
  return new Set(article.doc.en.blocks.flatMap((b) => (b.id === undefined ? [] : [b.id])))
}

/** `KB.someName` → the slug it stands for. */
const SLUG_BY_NAME = new Map<string, KbSlug>(Object.entries(KB))

describe('contextual help anchors', () => {
  it('every literal anchor in the app exists as a heading in the article it targets', () => {
    // matches `slug={KB.foo}` and a literal `anchor="bar"` in the same element, either order
    const PAIR = /slug=\{KB\.(\w+)\}[^>]*?anchor="([a-z0-9-]+)"|anchor="([a-z0-9-]+)"[^>]*?slug=\{KB\.(\w+)\}/g
    const checked: string[] = []
    for (const file of tsFiles(SRC)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(PAIR)) {
        const name = m[1] ?? m[4]!
        const anchor = m[2] ?? m[3]!
        const slug = SLUG_BY_NAME.get(name)
        expect(slug, `${file}: KB.${name} is not a known article`).toBeDefined()
        expect(anchorsOf(slug!).has(anchor), `${file}: ${slug}#${anchor} — no heading with that id`).toBe(true)
        checked.push(`${slug}#${anchor}`)
      }
    }
    // a regex that silently matches nothing would pass for ever
    expect(checked.length, 'found no anchored help links at all — the pattern stopped matching').toBeGreaterThan(5)
  })

  it('every DNS row anchor exists in the custom-domain article', () => {
    // These are passed as data (`anchor={r.docAnchor}`), so the scan above cannot see them: the
    // values live in the DnsRecord type in lib/branding.ts.
    const branding = readFileSync(join(SRC, 'lib/branding.ts'), 'utf8')
    const union = /docAnchor: ((?:'[a-z-]+'(?: \| )?)+)/.exec(branding)
    expect(union, 'lib/branding.ts no longer declares a docAnchor union — update this test').not.toBeNull()
    const values = [...union![1]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!)
    expect(values.length).toBeGreaterThan(0)
    const anchors = anchorsOf(KB.customDomain)
    for (const v of values) expect(anchors.has(v), `custom-domain#${v} — no heading with that id`).toBe(true)
  })
})
