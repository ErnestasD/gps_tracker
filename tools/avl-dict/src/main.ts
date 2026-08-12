import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyTypeConsensus, parseAvlTable, type AvlEntry } from './parse.js'

/**
 * Regenerate the AVL dictionaries from the Teltonika wiki (CLAUDE.md rule 8).
 *
 *   pnpm --filter @orbetra/avl-dict gen          # uses the on-disk cache where present
 *   pnpm --filter @orbetra/avl-dict gen --fresh  # refetch everything
 *
 * WHY this exists at all: the previous dictionaries were generated once, by hand, and then drifted.
 * `fmb1xx.json` was 51% behind the live table — missing the whole tachograph driver block, the
 * seatbelt and indicator-lamp flags, every BLE EYE sensor element, and 15 Signed parameters whose
 * absence makes a negative temperature read as a large positive. A dictionary nobody can regenerate
 * is a dictionary that silently rots, so the generator is the artefact and the JSON is its output.
 *
 * DEDUPLICATION IS BY CONTENT, not by the wiki's template structure. Most model pages transclude one
 * parameterless master template and therefore render a byte-identical table — FMB120 and FMC130 are
 * the same 640 rows today — while a handful carry their own inline table that happens to be the same
 * anyway. Hashing the parsed elements collapses both cases without us having to decide which is
 * which, and it answers the genuinely ambiguous ones empirically: FMC650 and FMM650 look like a wiki
 * bookkeeping error until you parse them and find 1198 versus 938 elements.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = resolve(HERE, '..')
const OUT = resolve(TOOL, '../../packages/codec/dictionaries')
const CACHE = resolve(TOOL, '.cache')
const UA = 'Mozilla/5.0 (compatible; OrbetraDictGen/1.0; +https://orbetra.com)'
const WIKI = 'https://wiki.teltonika-gps.com/view/'

interface ModelEntry { model: string; page: string }

/** Preferred names for shared tables, most recognisable first. Order matters; membership does not. */
const CANONICAL = ['FMB120', 'FMB640', 'FMC650', 'FMM650', 'FMC640', 'FMB001', 'TAT100', 'TST100', 'TFT100', 'GH5200', 'FMB930', 'FMB150', 'FMC150', 'FMM150']

async function fetchPage(page: string, fresh: boolean): Promise<string> {
  mkdirSync(CACHE, { recursive: true })
  const cached = join(CACHE, `${page}.html`)
  if (!fresh && existsSync(cached)) return readFileSync(cached, 'utf8')
  const res = await fetch(WIKI + page, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error(`${page}: HTTP ${res.status}`)
  const html = await res.text()
  writeFileSync(cached, html)
  return html
}

/**
 * One element per LINE. Fully indented JSON put every field on its own line and turned a routine
 * regeneration into a 2-million-line diff, which no reviewer can read and no PR tool enjoys; a
 * single minified line would be worse still — ungreppable and impossible to eyeball. This keeps a
 * dictionary skimmable (`grep '"141"' fmc650.json`) while a real change shows as a handful of lines.
 */
function serialise(file: Record<string, unknown> & { elements: Record<string, AvlEntry> }): string {
  const { elements, ...head } = file
  const headJson = JSON.stringify(head, null, 1).slice(0, -2) // drop the closing "\n}"
  const rows = Object.keys(elements)
    .sort((a, b) => Number(a) - Number(b))
    .map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(elements[id])}`)
  return `${headJson},
 "elements": {
${rows.join(',\n')}
 }
}
`
}

/** Stable identity for a parsed table: same elements ⇒ same dictionary file. */
const fingerprint = (els: Record<string, AvlEntry>): string =>
  createHash('sha256')
    .update(JSON.stringify(Object.keys(els).sort((a, b) => Number(a) - Number(b)).map((k) => [k, els[k]])))
    .digest('hex')
    .slice(0, 12)

async function main(): Promise<void> {
  const fresh = process.argv.includes('--fresh')
  const models = JSON.parse(readFileSync(join(TOOL, 'models.json'), 'utf8')) as ModelEntry[]
  const byPrint = new Map<string, { models: string[]; page: string; elements: Record<string, AvlEntry>; warnings: string[] }>()
  const failed: { model: string; reason: string }[] = []

  for (const m of models) {
    let html: string
    try {
      html = await fetchPage(m.page, fresh)
    } catch (e) {
      failed.push({ model: m.model, reason: (e as Error).message })
      continue
    }
    const { elements, warnings } = parseAvlTable(html)
    // An EMPTY parse is a failure, not an empty dictionary. Shipping one would quietly strip every
    // parameter name for that model, which reads to a customer exactly like the device being broken.
    if (Object.keys(elements).length === 0) {
      failed.push({ model: m.model, reason: 'no AVL table found on the page' })
      continue
    }
    const fp = fingerprint(elements)
    const seen = byPrint.get(fp)
    if (seen) seen.models.push(m.model)
    else byPrint.set(fp, { models: [m.model], page: m.page, elements, warnings })
  }

  // Cross-page consensus on the Type column — see applyTypeConsensus for why this exists and, more
  // importantly, why it is deliberately narrow. Warnings are attributed to the group they corrected.
  const groups = [...byPrint.values()]
  const corrections = applyTypeConsensus(groups.map((g) => g.elements))
  if (corrections.length > 0) {
    for (const g of groups) {
      for (const c of corrections) {
        const id = c.slice(3, c.indexOf(':'))
        if (g.elements[id] !== undefined && !g.warnings.includes(c)) g.warnings.push(c)
      }
    }
  }

  mkdirSync(OUT, { recursive: true })
  const retrieved = new Date().toISOString().slice(0, 10)
  const catalogue: { model: string; dictionary: string }[] = []
  const summary: { dictionary: string; elements: number; models: number; warnings: number }[] = []

  for (const [, group] of byPrint) {
    // Named after a CANONICAL model where the group has one, else alphabetically. Purely for the
    // human reading the repo: the 45-model master table sorts to `fm3001`, and nobody debugging an
    // FMB120 would think to open that file. The name has no runtime meaning — the catalogue maps
    // model → dictionary — so this is readability, not behaviour.
    const key = (CANONICAL.find((c) => group.models.includes(c)) ?? [...group.models].sort()[0]!).toLowerCase()
    const file = {
      table: key,
      source_url: WIKI + group.page,
      retrieved_at: retrieved,
      models: [...group.models].sort(),
      note: 'GENERATED by tools/avl-dict — do not hand-edit. Regenerate with `pnpm --filter @orbetra/avl-dict gen`.',
      warnings: group.warnings,
      elements: group.elements,
    }
    writeFileSync(join(OUT, `${key}.json`), serialise(file))
    for (const m of group.models) catalogue.push({ model: m, dictionary: key })
    summary.push({ dictionary: key, elements: Object.keys(group.elements).length, models: group.models.length, warnings: group.warnings.length })
  }

  catalogue.sort((a, b) => a.model.localeCompare(b.model))
  writeFileSync(join(OUT, 'catalogue.json'), `${JSON.stringify({ retrieved_at: retrieved, models: catalogue }, null, 1)}\n`)

  summary.sort((a, b) => b.elements - a.elements)
  for (const s of summary) console.log(`${s.dictionary.padEnd(10)} ${String(s.elements).padStart(5)} elements  ${String(s.models).padStart(3)} models  ${s.warnings} warnings`)
  console.log(`\n${summary.length} dictionaries for ${catalogue.length} models`)
  if (failed.length > 0) {
    console.log(`\n${failed.length} model(s) produced NO dictionary — they must be offered with an empty one or not at all:`)
    for (const f of failed) console.log(`  ${f.model}: ${f.reason}`)
  }
  const stale = readdirSync(OUT).filter((f) => f.endsWith('.json') && f !== 'catalogue.json' && !summary.some((s) => `${s.dictionary}.json` === f))
  if (stale.length > 0) console.log(`\nfiles no model maps to any more (delete them): ${stale.join(', ')}`)
}

void main()
