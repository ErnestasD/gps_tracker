import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { EVENT_KINDS, eventSummaryT } from '../src/lib/events.js'
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
 * Template literals (`t(\`affiliates.status.${s}\`)`) are DELIBERATELY not matched HERE: their key is
 * not knowable statically, and guessing at the interpolation would produce false failures that
 * teach people to disable the test. Their PREFIX is knowable, though, and the
 * 'template-literal keys' suite below checks that it resolves to an object in every catalog — which
 * is what would have caught `t(\`events.kind.${kind}\`)` against a leaf string.
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

/**
 * Template-literal keys, which the scanner above deliberately cannot see.
 *
 * `t(`events.k.${kind}`)` is invisible to a regex over literal `t('…')` calls, and that blind spot
 * shipped a real defect: the code asked for `events.kind.<kind>`, which is a leaf STRING in every
 * locale (the events page's column header), so i18next fell through to the default and showed a
 * Lithuanian operator "overspeed" and "power_cut" in raw English. Nothing failed. The set of kinds
 * is known at build time, so the cross-product can simply be asserted.
 */
const CATALOGS = { en, lt, pl, de }

const lookup = (cat: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), cat)

/**
 * Keys built from a template literal, which the scanner above deliberately cannot resolve.
 *
 * The scanner only sees `t('a.b.c')`. `t(`events.k.${kind}`)` is invisible to it, and that blind
 * spot shipped a real defect: the code asked for `events.kind.<kind>` while `events.kind` is a leaf
 * STRING in every locale (the events page's column header, "Tipas"). i18next then fell through to
 * the default and showed a Lithuanian operator "overspeed" and "power_cut" in raw English, with
 * nothing failing anywhere.
 *
 * The fix is to check the half the scanner CAN reach: whatever prefix a template key is built from
 * must resolve to an OBJECT in every catalog. A prefix that resolves to a string is the defect
 * itself; a prefix that resolves to nothing is a typo.
 */
describe('template-literal keys', () => {
  const files = sourceFiles(SRC)
  const prefixes = new Set<string>()
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*`([\w.]+)\.\$\{/g)) prefixes.add(m[1]!)
  }

  it('finds the prefixes to check (guards against the regex silently matching nothing)', () => {
    expect(prefixes.size).toBeGreaterThan(0)
  })

  it('every template prefix resolves to an OBJECT in every locale, never a string', () => {
    for (const prefix of prefixes) {
      for (const [lang, cat] of Object.entries(CATALOGS)) {
        const node = lookup(cat, prefix)
        expect(typeof node, `${lang}: t(\`${prefix}.\${...}\`) — ${JSON.stringify(node)?.slice(0, 40)}`).toBe('object')
      }
    }
  })
})

/**
 * And the catalog half: every kind the pipeline can emit has a label and, where it has one, a
 * summary — in all four languages. Derived from `eventSummaryT` itself rather than a hand-kept
 * list, so a new kind cannot be added to the switch and forgotten here.
 */
describe('event catalogs', () => {
  const PAYLOADS: Record<string, Record<string, unknown>> = {
    ignition: { ignition: true }, din_change: { din1: true },
    geofence: { name: 'x', transition: 'enter' }, fuel_theft: { drop: 1, unit: 'liters' },
  }
  /** Both branches of every key that switches on its payload. */
  const summaryKeys = new Set<string>()
  for (const kind of EVENT_KINDS) {
    for (const extra of [{}, PAYLOADS[kind] ?? {}, { ignition: false, din1: false, transition: 'exit', unit: 'percent', drop: 1 }]) {
      const d = eventSummaryT({ kind, payload: extra } as never)
      if (d !== null) summaryKeys.add(d.key)
    }
  }

  it('every event kind has a label in every locale', () => {
    for (const [lang, cat] of Object.entries(CATALOGS)) {
      for (const kind of EVENT_KINDS) expect(lookup(cat, `events.k.${kind}`), `${lang}: events.k.${kind}`).toBeTruthy()
    }
  })

  it('every summary key eventSummaryT can return exists in every locale', () => {
    expect(summaryKeys.size).toBeGreaterThan(EVENT_KINDS.length) // the on/off pairs are in there
    for (const [lang, cat] of Object.entries(CATALOGS)) {
      for (const key of summaryKeys) expect(lookup(cat, key), `${lang}: ${key}`).toBeTruthy()
    }
  })
})
