import { describe, expect, it } from 'vitest'

import { bodyText, KB_LANGS, type KbLang } from '../src/index.js'
import { KB_ARTICLES } from '../src/content.js'

/**
 * Prose hygiene.
 *
 * These are the mistakes that survive a careful read and only show up rendered: an unclosed `**`
 * swallowing half a paragraph, a stray backtick turning a sentence into code, a double space that
 * looks like a missing word. Cheap to check, invisible to review.
 */
describe('prose', () => {
  const strings = (lang: KbLang): { where: string; text: string }[] =>
    KB_ARTICLES.flatMap((a) => [
      { where: `${a.slug}/${lang}/title`, text: a.doc[lang].title },
      { where: `${a.slug}/${lang}/summary`, text: a.doc[lang].summary },
      { where: `${a.slug}/${lang}/body`, text: bodyText(a.doc[lang]) },
    ])

  it('has balanced bold markers', () => {
    for (const lang of KB_LANGS) {
      for (const { where, text } of strings(lang)) {
        // `**` always comes in pairs; an odd count means one paragraph swallowed the next
        expect((text.match(/\*\*/g) ?? []).length % 2, where).toBe(0)
      }
    }
  })

  it('has balanced code markers', () => {
    for (const lang of KB_LANGS) {
      for (const { where, text } of strings(lang)) {
        expect((text.match(/`/g) ?? []).length % 2, where).toBe(0)
      }
    }
  })

  it('has balanced link brackets', () => {
    for (const lang of KB_LANGS) {
      for (const { where, text } of strings(lang)) {
        expect((text.match(/\[/g) ?? []).length, where).toBe((text.match(/\]/g) ?? []).length)
      }
    }
  })

  it('has no double spaces or leading/trailing whitespace', () => {
    for (const lang of KB_LANGS) {
      for (const a of KB_ARTICLES) {
        const doc = a.doc[lang]
        for (const [what, text] of [['title', doc.title], ['summary', doc.summary]] as const) {
          expect(text, `${a.slug}/${lang}/${what}`).toBe(text.trim())
          expect(text.includes('  '), `${a.slug}/${lang}/${what}`).toBe(false)
        }
        for (const b of doc.blocks) {
          for (const t of [b.h2, b.p, ...(b.ul ?? []), ...(b.ol ?? [])]) {
            if (t === undefined) continue
            expect(t, `${a.slug}/${lang}: "${t.slice(0, 40)}"`).toBe(t.trim())
            expect(t.includes('  '), `${a.slug}/${lang}: "${t.slice(0, 40)}"`).toBe(false)
          }
        }
      }
    }
  })

  it('never leaves a link label empty or a bare URL in the prose', () => {
    for (const lang of KB_LANGS) {
      for (const { where, text } of strings(lang)) {
        expect(/\[\]\(/.test(text), `${where}: empty link label`).toBe(false)
        // a raw https:// outside a link is a URL somebody has to retype
        expect(/(?<!\()https?:\/\//.test(text), `${where}: bare URL`).toBe(false)
      }
    }
  })

  it('keeps summaries short enough to be a meta description', () => {
    for (const lang of KB_LANGS) {
      for (const a of KB_ARTICLES) {
        // search engines truncate around 160 characters; longer is a sentence nobody finishes
        expect(a.doc[lang].summary.length, `${a.slug}/${lang}`).toBeLessThanOrEqual(200)
      }
    }
  })
})
