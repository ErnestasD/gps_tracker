import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { AMBIGUOUS_UNITS, emittedUnitAfterMultiplier, needsDeclaration } from '../src/corrections.js'

/**
 * Do the DECISIONS and the SHIPPED FILES still agree?
 *
 * They were each checkable and never checked against each other: `corrections.spec.ts` reads only
 * this package, the codec sweeps read only the JSON, and nothing joined them. A mutation pass proved
 * what that costs — 59 of the 65 declarations could be deleted outright, or a shipped `"V"` bent to
 * `"kV"`, with every gate in the monorepo green. "Change a declaration, forget to run the generator"
 * is the single most likely edit this feature will ever see, and it was invisible.
 *
 * This is the join. It compares each shipped row against `emittedUnitAfterMultiplier` — the same
 * function main.ts writes with, not a copy of its logic — so it cannot drift from the generator, only
 * from the artifact, which is exactly what it is for.
 */
const DICTS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/codec/dictionaries')

interface El {
  name: string
  units?: string
  multiplier?: string
  unitAfterMultiplier?: string | null
  unitSource?: string
  unitRule?: string
}

const tables = readdirSync(DICTS)
  .filter((f) => f.endsWith('.json') && f !== 'catalogue.json')
  .map((f) => f.slice(0, -5))
  .sort()

const elementsOf = (table: string): Record<string, El> =>
  (JSON.parse(readFileSync(join(DICTS, `${table}.json`), 'utf8')) as { elements: Record<string, El> }).elements

describe('the shipped dictionaries against corrections.ts', () => {
  it('reads a real corpus — an empty one would make every sweep below pass vacuously', () => {
    expect(tables.length).toBeGreaterThan(30)
    expect(Object.keys(elementsOf('fmb120')).length).toBeGreaterThan(600)
  })

  it('every shipped row carries EXACTLY what the generator would emit for it today', () => {
    const drift: string[] = []
    for (const table of tables) {
      for (const [id, el] of Object.entries(elementsOf(table))) {
        const want = emittedUnitAfterMultiplier(table, id, el.units, el.multiplier)
        const got = 'unitAfterMultiplier' in el ? el.unitAfterMultiplier : undefined
        if (want !== got) {
          drift.push(`${table}:${id} ${el.name} — shipped ${JSON.stringify(got)}, corrections.ts says ${JSON.stringify(want)}`)
        }
      }
    }
    // a non-empty list means someone edited corrections.ts and did not run `pnpm --filter @orbetra/avl-dict gen`
    expect(drift).toEqual([])
  })

  it('the corpus still contains the shapes these decisions are ABOUT', () => {
    // a guard that passes because the rows vanished is not a guard. These counts move only when
    // Teltonika publishes or withdraws an ambiguous element, and moving one is a deliberate act.
    let ambiguous = 0
    let emitted = 0
    for (const table of tables) {
      for (const [, el] of Object.entries(elementsOf(table))) {
        if (needsDeclaration(el.units, el.multiplier)) ambiguous++
        if ('unitAfterMultiplier' in el) emitted++
      }
    }
    expect(ambiguous).toBe(57)
    expect(emitted).toBe(57)
  })

  it('every emitted row cites a bare wiki URL and names the decision that made it', () => {
    for (const table of tables) {
      for (const [id, el] of Object.entries(elementsOf(table))) {
        if (!('unitAfterMultiplier' in el)) continue
        expect(el.unitSource, `${table}:${id}`).toMatch(/^https:\/\/wiki\.teltonika-gps\.com\/view\/\S+$/)
        expect(el.unitRule, `${table}:${id}`).toMatch(/^[A-Z][A-Z_]+$/)
      }
    }
  })

  it('the ambiguity set is asserted against a LIST, not against itself', () => {
    // `for (const u of AMBIGUOUS_UNITS) expect(needsDeclaration(u, ...))` passes however much the set
    // shrinks — it iterates the thing under test. Dropping 'mm' or 'mA' was silent; this is not.
    expect([...AMBIGUOUS_UNITS].sort()).toEqual(['mA', 'mG', 'mV', 'mg', 'ml', 'mm'])
  })
})
