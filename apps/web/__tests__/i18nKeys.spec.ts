import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import de from '../src/i18n/de.json'
import en from '../src/i18n/en.json'
import lt from '../src/i18n/lt.json'
import pl from '../src/i18n/pl.json'

/**
 * The guard apps/web did not have.
 *
 * apps/site's locales are TypeScript objects checked against a `Translation` type, so a key that
 * exists in English and nowhere else fails the build. apps/web's are plain JSON with no such check,
 * and i18next's failure mode is silent: `t('common.cancel')` for a key that does not exist renders
 * the literal string `common.cancel` as the button label. Nothing throws, nothing logs, and it ships.
 *
 * That happened — the affiliates edit panel shipped with `common.cancel` and `common.save` against an
 * EMPTY `common` section, and typecheck, lint and 215 unit tests were all green. This suite is the
 * cheapest thing that would have caught it.
 *
 * Two properties, because the two failures are different:
 *  1. every `t('literal')` in the source resolves in English — catches a typo or a wrong namespace;
 *  2. all four locales carry the same keys — catches a translation that was added in one language
 *     and forgotten in three, which shows a user a fragment of English (or a raw key) mid-sentence.
 */
const SRC = resolve(import.meta.dirname, '../src')

/** Every .ts/.tsx under src, so a new folder is covered without touching this file. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

/**
 * `t('a.b')` / `t("a.b")` only.
 *
 * Template literals (`t(\`affiliates.status.${s}\`)`) are DELIBERATELY not matched: their key is not
 * knowable statically, and guessing at the interpolation would produce false failures that teach
 * people to disable the test. The dynamic ones are the minority and are covered by the parity check
 * below plus their own unit tests.
 */
const T_CALL = /\bt\(\s*(['"])([A-Za-z][\w.]*)\1/g

/**
 * COMMENTS ARE STRIPPED FIRST. This file's own first draft failed on `t('x.sure')` written inside a
 * JSDoc usage example in ConfirmDialog — illustrative pseudo-code, not a call site. A test that
 * flags documentation is a test people delete, so the scanner drops block comments and whole-line
 * `//` / ` *` lines before matching. It can therefore miss a real key inside a commented-out block;
 * that direction is harmless, the other is not.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '')
}

function flatten(obj: unknown, prefix = ''): Set<string> {
  const out = new Set<string>()
  if (obj === null || typeof obj !== 'object') return out
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix === '' ? k : `${prefix}.${k}`
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const nested of flatten(v, path)) out.add(nested)
    } else {
      out.add(path)
    }
  }
  return out
}

/**
 * i18next resolves `key_one` / `key_other` (plurals) and `key_male` (context) from a base `key`, so a
 * source calling `t('x.window')` is satisfied by `x.window_one` + `x.window_other`. Accept either.
 */
const SUFFIXED = /_(zero|one|two|few|many|other|male|female)$/
function resolves(key: string, keys: Set<string>): boolean {
  if (keys.has(key)) return true
  for (const k of keys) if (k.startsWith(`${key}_`) && SUFFIXED.test(k)) return true
  return false
}

const EN = flatten(en)

describe('i18n keys', () => {
  it('every literal t() key in the source exists in English', () => {
    const missing: string[] = []
    for (const file of sourceFiles(SRC)) {
      const text = stripComments(readFileSync(file, 'utf8'))
      for (const m of text.matchAll(T_CALL)) {
        const key = m[2]
        if (key === undefined || resolves(key, EN)) continue
        missing.push(`${file.slice(SRC.length + 1)} → ${key}`)
      }
    }
    // the message carries the offenders: a bare `expect(0)` would say "expected 3 to be 0"
    expect(missing, `missing translation keys:\n${missing.join('\n')}`).toEqual([])
  })

  it('every locale carries the same keys as English', () => {
    for (const [name, dict] of [
      ['lt', lt],
      ['de', de],
      ['pl', pl],
    ] as const) {
      const keys = flatten(dict)
      const missing = [...EN].filter((k) => !keys.has(k))
      const extra = [...keys].filter((k) => !EN.has(k))
      expect(missing, `${name}.json is missing:\n${missing.join('\n')}`).toEqual([])
      expect(extra, `${name}.json has keys English does not:\n${extra.join('\n')}`).toEqual([])
    }
  })
})
