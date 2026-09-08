import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { AVL_NAMES_DE } from '../src/lib/avlNames.de'
import { AVL_NAMES_LT } from '../src/lib/avlNames.lt'
import { AVL_NAMES_PL } from '../src/lib/avlNames.pl'
import { avlPattern, translateAvlName } from '../src/lib/avlNames'

/**
 * Element names in the operator's language.
 *
 * The wiki is English, so the dictionaries are: 2,718 distinct names across the 37 shipped tables.
 * Numbers are what make that tractable — "Battery Voltage 1".."Battery Voltage 10" is one phrase —
 * so the unit of translation is the name with every run of digits replaced by `#`, which collapses
 * them to 1,553 patterns.
 */
const TABLES = { lt: AVL_NAMES_LT, pl: AVL_NAMES_PL, de: AVL_NAMES_DE }

describe('translateAvlName', () => {
  it('puts the numbers back where the phrase says they go', () => {
    expect(translateAvlName('Battery Voltage 3', 'lt')).toBe('Akumuliatoriaus įtampa 3')
    expect(translateAvlName('Tire 4 pressure', 'lt')).toBe('4 padangos slėgis')
    // `#` is a LITERAL in Teltonika's names, so it survives translation and only digits move
    expect(translateAvlName('BLE 2 Custom #14', 'lt')).toBe('BLE 2 pasirinktinis #14')
    expect(translateAvlName('Tire 4 pressure', 'de')).toBe('Reifendruck 4')
  })

  it('an unknown pattern stays English — never half-translated', () => {
    // the fallback is the contract: it is what lets this table grow one line at a time
    expect(translateAvlName('Retract Port Measured Flow 2', 'lt')).toBe('Retract Port Measured Flow 2')
  })

  it('a language we have no table for is left alone', () => {
    expect(translateAvlName('Fuel Level', 'fr')).toBe('Fuel Level')
    expect(translateAvlName('Fuel Level', 'en')).toBe('Fuel Level')
  })

  it('matches on the two-letter prefix, like the rest of the app', () => {
    expect(translateAvlName('Fuel Level', 'lt-LT')).toBe('Kuro lygis')
  })
})

describe('the tables themselves', () => {
  it('every language carries exactly the same patterns', () => {
    // a key present in one language and missing in another is a row that changes language when the
    // operator does, which reads as a bug rather than as a gap
    const lt = Object.keys(AVL_NAMES_LT).sort()
    expect(Object.keys(AVL_NAMES_PL).sort()).toEqual(lt)
    expect(Object.keys(AVL_NAMES_DE).sort()).toEqual(lt)
  })

  it('a translation carries the same placeholders as its pattern', () => {
    // dropping a `{}` would silently merge "Tire 1" and "Tire 4" into one row
    for (const [lang, table] of Object.entries(TABLES)) {
      for (const [pattern, translated] of Object.entries(table)) {
        const want = (pattern.match(/\{\}/g) ?? []).length
        const got = (translated.match(/\{\}/g) ?? []).length
        expect(`${lang} ${pattern} → ${got}`).toBe(`${lang} ${pattern} → ${want}`)
      }
    }
  })

  it('every key is already a pattern — a stray digit would never match', () => {
    for (const key of Object.keys(AVL_NAMES_LT)) expect(avlPattern(key)).toBe(key)
  })

  it('every key names an element that actually exists in a shipped dictionary', () => {
    // a typo in a key is invisible at runtime: it simply never matches, and the row stays English
    const dir = join(__dirname, '..', '..', '..', 'packages', 'codec', 'dictionaries')
    const real = new Set<string>()
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const els = (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { elements?: Record<string, { name?: string }> }).elements ?? {}
      for (const e of Object.values(els)) if (e.name) real.add(avlPattern(e.name.trim()))
    }
    const unknown = Object.keys(AVL_NAMES_LT).filter((k) => !real.has(k))
    expect(unknown).toEqual([])
  })

  it('reports how much of the catalogue is covered', () => {
    const dir = join(__dirname, '..', '..', '..', 'packages', 'codec', 'dictionaries')
    let total = 0
    let covered = 0
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const els = (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { elements?: Record<string, { name?: string }> }).elements ?? {}
      for (const e of Object.values(els)) {
        if (!e.name) continue
        total += 1
        if (AVL_NAMES_LT[avlPattern(e.name.trim())] !== undefined) covered += 1
      }
    }
    // A ratchet, not a target: it may only ever go up. The remaining tail is exotic CAN-adapter
    // elements for specific vehicle brands, each used once, and they render in English.
    const pct = (covered / total) * 100
    console.log(`AVL name coverage: ${covered}/${total} entries (${pct.toFixed(1)}%)`)
    expect(pct).toBeGreaterThan(55)
  })
})
