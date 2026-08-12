import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyRangeConsensus, applyTypeConsensus, parseAvlTable, type AvlEntry } from './parse.js'

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
 * bookkeeping error until you parse them and find 1198 versus 938 rows (1197 usable — one id is
 * above the AVL ceiling, see parseAvlTable).
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

/** Compare two dictionary files ignoring the capture date, so an unchanged table is not rewritten. */
const stripDate = (json: string): string => json.replace(/^ "retrieved_at": ".*",$/m, '')

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

interface Group { models: string[]; page: string; elements: Record<string, AvlEntry>; warnings: string[] }

/**
 * Elements that Teltonika's OWN "HW Support" column says a model produces, on a page that model's
 * table does not include. This is a property of the wiki, not of the parse, and it is large:
 *
 *   FMM650 and FMB641 transclude `Template:FMX640 AVL ID` (last edited 2026-02-25) while the newer
 *   `Template:FMX650 AVL ID` renders only on FMC650. So 305 elements whose HW Support literally
 *   reads "FMC650, FMM650" — the CAN adapter block, the iCam states, `449 Ignition On Counter` —
 *   are documented for FMM650 on one page and missing from its own. FMB641: 298. FMC640: 27.
 *
 * Nothing is copied across: the wiki is the authority (CLAUDE.md) and inferring an element onto a
 * model from a HW Support string is exactly the inference rule 8 forbids. What we CAN do is stop it
 * being invisible — a support question of the form "why does my FMM650 not report ground speed?"
 * should land on a recorded fact, not on a shrug. One summary line per table, not one per element.
 */
function crossPageGaps(groups: Group[]): (string | undefined)[] {
  const tokens = (hw: string | undefined): Set<string> => new Set((hw ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean))
  return groups.map((g) => {
    // exact model tokens only — HW Support also carries family wildcards like FMBXXX/FMX6XX, and
    // "this table's models appear in that wildcard" is a guess, not a claim the wiki made
    const mine = g.models.map((m) => m.toUpperCase())
    const missing = new Map<string, string>()
    for (const other of groups) {
      if (other === g) continue
      for (const [id, e] of Object.entries(other.elements)) {
        if (id in g.elements || missing.has(id)) continue
        const hw = tokens(e.hwSupport)
        if (mine.some((m) => hw.has(m))) missing.set(id, e.name)
      }
    }
    if (missing.size === 0) return undefined
    const eg = [...missing.entries()].slice(0, 3).map(([id, n]) => `${id} "${n}"`).join(', ')
    return `source: ${missing.size} element(s) are documented on another Teltonika page whose HW Support column names a model of this table, yet are absent from this table's own page (e.g. ${eg}). Teltonika's page is the authority, so nothing is copied across — this records the gap rather than hiding it.`
  })
}

/** Stable identity for a parsed table: same elements ⇒ same dictionary file. */
const fingerprint = (els: Record<string, AvlEntry>): string =>
  createHash('sha256')
    .update(JSON.stringify(Object.keys(els).sort((a, b) => Number(a) - Number(b)).map((k) => [k, els[k]])))
    .digest('hex')
    .slice(0, 12)

/**
 * Is `models.json` COMPLETE? Nothing else in this tool can answer that: a model we never listed
 * produces no dictionary, no failure and no warning — it is simply absent from the picker, and the
 * only symptom is a customer who cannot find their device. So ask the wiki for its own index
 * (`list=allpages`, ~6.8k mainspace titles) and diff the AVL-parameter pages against our list.
 *
 *   pnpm --filter @orbetra/avl-dict gen --coverage
 *
 * Run 2026-08-12: 115 AVL-parameter pages exist, all 105 of ours are among them, and the 10 extras
 * are NOT missing models. Eight are accessory/aggregate articles (ADAS, DSM, DashCam, Dashcam,
 * DualCam, Iridium Edge, "AVL ID differences between FMB and FT platforms", "Full AVL ID List
 * (Mobility)"); the other two, `FMB630 AVL ID` and `FMB962 AVL ID`, are older duplicate titles for
 * models we already have — fetched and compared id-for-id, both carry exactly the same set as the
 * `…_Teltonika_Data_Sending_Parameters_ID` page we use (265 and 640), so there is nothing to gain.
 *
 * The accessory pages stay out deliberately. Their elements already appear in the model tables
 * Teltonika chose to put them in (FMC650 carries the iCam/DualCam block); folding them into a model
 * that does not list them would be asserting hardware support the wiki never claimed, which is the
 * inference rule 8 exists to prevent. `crossPageGaps` already records where that bites.
 */
async function coverage(models: ModelEntry[]): Promise<void> {
  const titles: string[] = []
  let cont: string | undefined
  do {
    const url = `https://wiki.teltonika-gps.com/api.php?action=query&list=allpages&apnamespace=0&aplimit=500&format=json${cont ? `&apcontinue=${encodeURIComponent(cont)}` : ''}`
    const res = await fetch(url, { headers: { 'user-agent': UA } })
    if (!res.ok) throw new Error(`wiki index: HTTP ${res.status}`)
    const body = (await res.json()) as { query?: { allpages?: { title: string }[] }; continue?: { apcontinue?: string } }
    for (const p of body.query?.allpages ?? []) titles.push(p.title)
    cont = body.continue?.apcontinue
  } while (cont !== undefined)

  const avlPages = titles.filter((t) => /(Data Sending Parameters ID|AVL ID)/i.test(t))
  const have = new Set(models.map((m) => m.page.replace(/_/g, ' ')))
  const extra = avlPages.filter((t) => !have.has(t)).sort()
  const gone = [...have].filter((t) => !avlPages.includes(t)).sort()
  console.log(`wiki index: ${titles.length} mainspace pages, ${avlPages.length} AVL-parameter pages; models.json lists ${have.size}`)
  // A page we list that the index no longer has is the serious direction — it means a model page
  // was renamed or removed and our dictionary is pinned to a URL that will 404 on the next --fresh.
  if (gone.length > 0) console.error(`\n${gone.length} page(s) in models.json are NOT in the wiki index:\n  ${gone.join('\n  ')}`)
  console.log(`\n${extra.length} AVL page(s) on the wiki are not in models.json — each is either an accessory page or a duplicate title, and each needs a human decision:\n  ${extra.join('\n  ')}`)
  if (gone.length > 0) process.exitCode = 1
}

/** Models that produced no dictionary at all. Shared so a bail-out path cannot omit them. */
function reportFailures(failed: { model: string; reason: string }[]): void {
  if (failed.length === 0) return
  console.error(`\n${failed.length} model(s) produced NO dictionary — they must be offered with an empty one or not at all:`)
  for (const f of failed) console.error(`  ${f.model}: ${f.reason}`)
  // A 404 used to exit 0: the model vanished from the catalogue, every element for it became
  // unnamed, and `pnpm gen && git commit` would land it as a success.
  process.exitCode = 1
}

async function main(): Promise<void> {
  const fresh = process.argv.includes('--fresh')
  const models = JSON.parse(readFileSync(join(TOOL, 'models.json'), 'utf8')) as ModelEntry[]
  if (process.argv.includes('--coverage')) return coverage(models)
  const byPrint = new Map<string, Group>()
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
  for (const c of applyTypeConsensus(groups.map((g) => g.elements))) groups[c.table]!.warnings.push(c.note)
  // …and the RANGE, which applySign now reads as evidence too. AFTER the type pass, because it only
  // considers entries that are already Signed.
  for (const c of applyRangeConsensus(groups.map((g) => g.elements))) groups[c.table]!.warnings.push(c.note)
  // …and record what Teltonika documents for these models elsewhere but not here. Runs AFTER
  // consensus so a table's warnings read in the order they were established.
  for (const [i, note] of crossPageGaps(groups).entries()) if (note !== undefined) groups[i]!.warnings.push(note)

  mkdirSync(OUT, { recursive: true })
  const retrieved = new Date().toISOString().slice(0, 10)
  const catalogue: { model: string; dictionary: string }[] = []
  let unchanged = 0
  const shrunk: string[] = []
  const summary: { dictionary: string; elements: number; models: number; warnings: number }[] = []

  // Name every group FIRST, so a regrouping can be caught BEFORE a single file is written.
  const named = [...byPrint.values()].map((group) => ({
    group,
    // Named after a CANONICAL model where the group has one, else alphabetically. Purely for the
    // human reading the repo: the 45-model master table sorts to `fm3001`, and nobody debugging an
    // FMB120 would think to open that file. The name has no runtime meaning — the catalogue maps
    // model → dictionary — so this is readability, not behaviour.
    key: (CANONICAL.find((c) => group.models.includes(c)) ?? [...group.models].sort()[0]!).toLowerCase(),
  }))

  /**
   * A REGROUPING is the shrink guard's blind spot, and it is the more dangerous shape.
   *
   * That guard compares a table against the file already on disk, so it only sees a truncation that
   * KEEPS the group's identity. Deduplication is by content hash, and a truncated page no longer
   * hashes with its family: FMC130 renders byte-identical to FMB120 today and lives in the 45-model
   * `fmb120` group, but a truncated FMC130 page becomes its own group keyed `fmc130`, whose file
   * does not exist — so nothing shrank, nothing was reported, and a new truncated dictionary would
   * be written with the run exiting 0.
   *
   * THIS RUNS BEFORE THE WRITE LOOP, and that placement is the whole point. A first version checked
   * after the loop and returned early: it left 34 rewritten dictionaries on disk beside a catalogue
   * that still pointed at the old grouping, while printing "nothing was written to the catalogue" —
   * which reads as "nothing was written". Detect it while the tree is still untouched.
   *
   * Teltonika splitting or merging a template is a REAL event that belongs in a diff a human reads,
   * so this reports rather than fails silently, and `--allow-remap` is how that human says yes.
   */
  const cataloguePath = join(OUT, 'catalogue.json')
  const cataloguePrev = existsSync(cataloguePath) ? readFileSync(cataloguePath, 'utf8') : ''
  let prevModels: { model: string; dictionary: string }[] = []
  if (cataloguePrev !== '') {
    try {
      // UNREADABLE IS NOT ABSENT, and conflating them disabled this whole guard. A half-written
      // catalogue (this tool deploys by rsync) parsed to "no previous mapping", so `remapped` came
      // back empty, a truncated page's brand-new dictionary was written, and the run exited 0 — the
      // exact silent landing the guard exists to prevent, reachable by damaging the one file the
      // guard reads. Validate the SHAPE too: `JSON.parse('{}').models` is `undefined`, which used
      // to throw one line later, outside the try.
      const parsed = JSON.parse(cataloguePrev) as { models?: unknown }
      if (!Array.isArray(parsed.models)) throw new Error('no models array')
      prevModels = parsed.models as { model: string; dictionary: string }[]
    } catch {
      console.error('catalogue.json exists but is unreadable — cannot tell whether a regrouping happened, so NOTHING was written')
      console.error('  delete it deliberately if you mean to rebuild the mapping from scratch')
      reportFailures(failed) // …and do not hide a 404 behind it: that costs the operator a second run
      process.exitCode = 1
      return
    }
  }
  const prevMap = new Map(prevModels.map((m) => [m.model, m.dictionary]))
  const remapped = named.flatMap(({ group, key }) =>
    group.models.filter((m) => prevMap.has(m) && prevMap.get(m) !== key).map((m) => `${m}: ${prevMap.get(m)!} → ${key}`),
  )
  // A MODEL THAT PRODUCED NOTHING gets the same treatment as a regrouping, and for the same reason.
  // A 404 or an unparseable page used to be reported while the catalogue was still rewritten WITHOUT
  // that model — so it silently left `DEVICE_PROFILES` (generated from the catalogue) and the
  // picker, and its dictionary was orphaned on disk. Both are "the wiki changed under us"; both
  // must leave the tree untouched so the operator decides.
  if (failed.length > 0) {
    reportFailures(failed)
    console.error('  NOTHING was written — check those pages, or remove the model from models.json')
    return
  }
  if (remapped.length > 0) {
    const allow = process.argv.includes('--allow-remap')
    const say = allow ? console.log : console.error
    say(`\n${remapped.length} model(s) moved to a DIFFERENT dictionary — a wiki regrouping, or a parse that truncated one page out of its family:`)
    for (const m of remapped) say(`  ${m}`)
    if (!allow) {
      // …and report the OTHER failures before bailing. A 404 and a regrouping in the same run used
      // to cost two round trips: the operator saw only the remap, fixed it, re-ran, and only then
      // learned a page had 404'd. A tool whose whole point is that failures are not silent must not
      // hide one behind another.
      reportFailures(failed)
      console.error('  NOTHING was written — re-run with --allow-remap once you have checked those pages')
      process.exitCode = 1
      return
    }
  }

  for (const { group, key } of named) {
    const file = {
      table: key,
      // the page of the model the file is NAMED after, not whichever model sorted first into the
      // hash group: a reviewer checking a rule-8 citation for "the FMB120 table" must land on
      // FMB120's page, not FM3001's. Content-identical either way — this is about traceability.
      source_url: WIKI + (models.find((m) => m.model.toLowerCase() === key)?.page ?? group.page),
      retrieved_at: retrieved,
      models: [...group.models].sort(),
      note: 'GENERATED by tools/avl-dict — do not hand-edit. Regenerate with `pnpm --filter @orbetra/avl-dict gen`.',
      warnings: group.warnings,
      elements: group.elements,
    }
    // Rewrite ONLY when the content changed. `retrieved_at` is today's date, so writing
    // unconditionally would rewrite all 34 files on every run and turn "regenerate and read the
    // diff" — the whole point of having a generator — into a wall of date changes that hides the one
    // element Teltonika actually edited. The date therefore means "when this CONTENT was captured".
    const path = join(OUT, `${key}.json`)
    const next = serialise(file)
    const prev = existsSync(path) ? readFileSync(path, 'utf8') : ''
    // A dictionary that SHRINKS is a parser failure, not a smaller table. A non-greedy table match
    // once truncated FM36 at a nested <table> inside a Description cell and shipped 12 of 137
    // elements — losing Ignition, Movement, the Dallas temperatures and the odometer — with an
    // empty warnings array and a successful run. The only quality gate was "more than zero".
    let lost = false
    if (prev !== '') {
      const before = ((/^ {2}"\d+":/gm.exec(prev) ? prev.match(/^ {2}"\d+":/gm) : null) ?? []).length
      const after = Object.keys(group.elements).length
      if (before > 0 && after < before * 0.9) {
        shrunk.push(`${key}: ${before} → ${after} elements`)
        lost = true
      }
    }
    // …and DO NOT WRITE IT. Reporting a parser failure while the truncated file is already on disk
    // is not a guard, it is a note attached to the damage: the operator reads "treat as a parser
    // failure" with the bad dictionary committed under their cursor, and `git checkout` is the only
    // way back. The good file stays, the exit code is non-zero, and the run is repeatable.
    if (lost) {
      console.error(`  ${key}: NOT written — the existing file is kept`)
      unchanged++ // it was not rewritten; counting it as such would tell the operator the opposite
    } else if (stripDate(prev) !== stripDate(next)) writeFileSync(path, next)
    else unchanged++
    for (const m of group.models) catalogue.push({ model: m, dictionary: key })
    summary.push({ dictionary: key, elements: Object.keys(group.elements).length, models: group.models.length, warnings: group.warnings.length })
  }

  catalogue.sort((a, b) => a.model.localeCompare(b.model))
  const catalogueNext = `${JSON.stringify({ retrieved_at: retrieved, models: catalogue }, null, 1)}\n`
  // same reason as the dictionaries: a date-only rewrite is noise that hides the real change
  if (stripDate(cataloguePrev) !== stripDate(catalogueNext)) writeFileSync(cataloguePath, catalogueNext)

  summary.sort((a, b) => b.elements - a.elements)
  for (const s of summary) console.log(`${s.dictionary.padEnd(10)} ${String(s.elements).padStart(5)} elements  ${String(s.models).padStart(3)} models  ${s.warnings} warnings`)
  console.log(`\n${summary.length} dictionaries for ${catalogue.length} models (${unchanged} unchanged, ${summary.length - unchanged} rewritten)`)
  if (shrunk.length > 0) {
    console.error(`\n${shrunk.length} dictionary/ies LOST elements — treat as a parser failure, not a smaller table:`)
    for (const s of shrunk) console.error(`  ${s}`)
    process.exitCode = 1
  }
  reportFailures(failed)
  const stale = readdirSync(OUT).filter((f) => f.endsWith('.json') && f !== 'catalogue.json' && !summary.some((s) => `${s.dictionary}.json` === f))
  if (stale.length > 0) console.log(`\nfiles no model maps to any more (delete them): ${stale.join(', ')}`)
}

void main()
