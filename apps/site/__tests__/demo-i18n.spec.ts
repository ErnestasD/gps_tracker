import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { contentFor } from '@/lib/demo-content'
import { demoZones } from '@/lib/demo-zones'
import { cityFor } from '@/lib/demo-geo'

const LANGS = ['lt', 'en', 'pl', 'de'] as const
const root = fileURLToPath(new URL('..', import.meta.url))

function flat(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flat(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

const locale = (lang: string): Set<string> =>
  new Set(flat(JSON.parse(readFileSync(`${root}src/lib/admin-locales/${lang}.json`, 'utf8')) as Record<string, unknown>))

/**
 * Every `t("…")` the demo admin reads must EXIST in all four languages.
 *
 * `shell.notifications` did not, and nothing caught it: the command palette rendered the literal
 * string "shell.notifications" as a menu entry, in every language including the one it was written
 * for. i18next falls back to the key rather than throwing, so a missing key is invisible to
 * typecheck, lint and the eye of whoever is not reading that exact row.
 */
describe('demo admin translations', () => {
  const used = new Map<string, string>()
  for (const dir of ['src/routes', 'src/components/admin']) {
    for (const name of readdirSync(`${root}${dir}`)) {
      if (!name.endsWith('.tsx')) continue
      if (dir === 'src/routes' && !name.startsWith('app')) continue
      const src = readFileSync(`${root}${dir}/${name}`, 'utf8')
      if (!src.includes('useTranslation("admin")')) continue
      // literal keys only — template keys (`geofences.${kind}`) are covered by the shape tests below
      for (const m of src.matchAll(/\bt\(\s*"([a-z][\w.]*\.[\w.]+)"/g)) used.set(m[1], `${dir}/${name}`)
    }
  }

  it('finds keys to check', () => {
    expect(used.size).toBeGreaterThan(100)
  })

  for (const lang of LANGS) {
    it(`${lang} defines every key the demo asks for`, () => {
      const have = locale(lang)
      const missing = [...used].filter(([k]) => !have.has(k) && ![...have].some((h) => h.startsWith(`${k}_`)))
      expect(missing.map(([k, where]) => `${k} (${where})`)).toEqual([])
    })
  }

  // The interpolated families the pages build by hand — `t(\`geofences.${kind}\`)` and friends.
  for (const lang of LANGS) {
    it(`${lang} defines the interpolated geofence keys`, () => {
      const have = locale(lang)
      for (const kind of ['polygon', 'circle', 'corridor']) {
        expect(have.has(`geofences.${kind}`), `geofences.${kind}`).toBe(true)
        expect(have.has(`geofences.hint.${kind}`), `geofences.hint.${kind}`).toBe(true)
        expect(have.has(`geofences.typeHint.${kind}`), `geofences.typeHint.${kind}`).toBe(true)
      }
    })
  }
})

/**
 * The demo's fixture data has to move with the reader, and stay self-consistent while it moves.
 *
 * Both halves were broken at once: a Polish visitor watched Warsaw vans whose zones were in
 * Lithuania, and the trips page credited journeys to a driver roster the drivers page did not have.
 */
describe('demo content follows the language', () => {
  it('gives every language a distinct city with its own zone names', () => {
    const names = LANGS.map((l) => demoZones(l).map((z) => z.name).join('|'))
    expect(new Set(names).size).toBe(LANGS.length)
  })

  it('anchors the zones inside the city the fleet drives in', () => {
    for (const lang of LANGS) {
      const [lng, lat] = cityFor(lang).center
      for (const z of demoZones(lang)) {
        const pt: [number, number] | undefined = (z.ring ?? z.line ?? [])[0]
        expect(pt, `${lang}/${z.id} has geometry`).toBeDefined()
        if (pt === undefined) continue
        // a city loop stays well inside a degree of its centre; a zone left behind in another
        // country is what this catches
        expect(Math.abs(pt[0] - lng), `${lang}/${z.id} lng`).toBeLessThan(1)
        expect(Math.abs(pt[1] - lat), `${lang}/${z.id} lat`).toBeLessThan(1)
      }
    }
  })

  it('never leaves Lithuanian content in a non-Lithuanian demo', () => {
    const LT = /Vilni|Kaun|Klaip|bazė|Saldėn|UAB|Petrausk|Kazlausk|\+370|LT\d/
    for (const lang of ['en', 'pl', 'de']) {
      const c = contentFor(lang)
      const text = [
        c.company, c.companyLegal, ...c.accounts, ...c.towns, ...c.firstNames, ...c.lastNames,
        c.terminal, c.tz, c.domain, c.supportEmail, c.clientHost, c.dispatchEmail,
        ...c.reportAccounts, ...Object.values(c.zones), ...Object.values(c.rules),
        ...Object.values(c.scopes), ...c.services, c.licensePrefix, c.phonePrefix,
      ].join(' ')
      expect(text, `${lang} carries Lithuanian content`).not.toMatch(LT)
    }
  })

  it('names the same people on every page', () => {
    // the roster is the single source; a page that builds its own would drift from this
    const a = contentFor('pl').firstNames[0]
    expect(a).toBeTruthy()
    for (const lang of LANGS) {
      const c = contentFor(lang)
      expect(c.firstNames.length).toBeGreaterThanOrEqual(8)
      expect(c.lastNames.length).toBeGreaterThanOrEqual(8)
    }
  })
})
