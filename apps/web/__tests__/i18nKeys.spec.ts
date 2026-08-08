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
    // Compared on the BASE key, with the plural/context suffix stripped. Languages do not agree on
    // how many plural forms exist — English needs one/other where Lithuanian needs one/few/other and
    // Polish one/few/many/other — so an exact key-set match would forbid correct translations. The
    // first draft of this test did exactly that, and would have blocked the fix for "1 klientai".
    const base = (k: string) => k.replace(SUFFIXED, '')
    const enBase = new Set([...EN].map(base))
    for (const [name, dict] of [
      ['lt', lt],
      ['de', de],
      ['pl', pl],
    ] as const) {
      const keys = new Set([...flatten(dict)].map(base))
      const missing = [...enBase].filter((k) => !keys.has(k))
      const extra = [...keys].filter((k) => !enBase.has(k))
      expect(missing, `${name}.json is missing:\n${missing.join('\n')}`).toEqual([])
      expect(extra, `${name}.json has keys English does not:\n${extra.join('\n')}`).toEqual([])
    }
  })

  it('a pluralised string carries every form its language needs', () => {
    // i18next v4 CLDR categories. A key with `_one` and no `_few` renders the English-shaped
    // fallback for 2–9 in Lithuanian, which is the "1 klientai" bug in the other direction.
    const REQUIRED = { en: ['one', 'other'], de: ['one', 'other'], lt: ['one', 'few', 'other'], pl: ['one', 'few', 'many', 'other'] }
    for (const [name, dict] of [
      ['en', en],
      ['lt', lt],
      ['de', de],
      ['pl', pl],
    ] as const) {
      const keys = flatten(dict)
      const plural = new Set([...keys].filter((k) => SUFFIXED.test(k)).map((k) => k.replace(SUFFIXED, '')))
      for (const b of plural) {
        const missing = REQUIRED[name].filter((form) => !keys.has(`${b}_${form}`))
        expect(missing, `${name}.json: ${b} is missing ${missing.join(', ')}`).toEqual([])
      }
    }
  })
})
