import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseParameterList, EDITABLE_PARAMS, OBSERVED_PARAMS, type ModelParams } from './parseParams.js'

/**
 * Generator for the CONFIGURABLE-parameter ranges, the sibling of the AVL-element generator.
 *
 * Two different wiki pages, and confusing them is easy: `<MODEL>_Teltonika_Data_Sending_Parameters_ID`
 * lists what a device SENDS (AVL elements — main.ts), while `<MODEL>_Parameter_List` lists what a
 * device can be SET to. Only the second one carries the min/max we are about to hand a customer.
 *
 * Why generate rather than hand-write the ranges: the ids are NOT universal. Parameter 11813 exists
 * on FTC/FTM and not on ATC or FMB; 121 exists on the FT platform and not on FMB120. Naming an id a
 * model does not implement risks the device rejecting the whole setparam — so "which models have
 * this parameter, and with what bounds" has to be read from each model's own page, not assumed.
 * That assumption is exactly what cost a day of hardware time on 2026-08-18.
 *
 *   pnpm --filter @orbetra/avl-dict gen:params
 *   pnpm --filter @orbetra/avl-dict gen:params --fresh   # refetch instead of using the cache
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = resolve(HERE, '..')
const CACHE = resolve(TOOL, '.cache')
const OUT = resolve(TOOL, '../../packages/shared/params/deviceParams.json')
const UA = 'Mozilla/5.0 (compatible; OrbetraDictGen/1.0; +https://orbetra.com)'
const WIKI = 'https://wiki.teltonika-gps.com/view/'

interface ModelEntry { model: string; page: string }

async function fetchPage(page: string, fresh: boolean): Promise<string | null> {
  mkdirSync(CACHE, { recursive: true })
  const cached = join(CACHE, `${page}.html`)
  if (!fresh && existsSync(cached)) return readFileSync(cached, 'utf8')
  const res = await fetch(WIKI + page, { headers: { 'user-agent': UA } })
  // a model with no Parameter_List page is a real answer, not an error: it means we cannot offer
  // settings for it, and the UI must say so rather than guess bounds from a sibling model.
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${page}: HTTP ${res.status}`)
  const html = await res.text()
  writeFileSync(cached, html)
  return html
}

async function main(): Promise<void> {
  const fresh = process.argv.includes('--fresh')
  const models = JSON.parse(readFileSync(join(TOOL, 'models.json'), 'utf8')) as ModelEntry[]

  const out: Record<string, ModelParams> = {}
  const noPage: string[] = []
  const warnings: string[] = []

  for (const { model } of models) {
    // The wiki spells this page BOTH ways and the difference is per-platform, not per-page-author:
    // the FT/AT models use `_Parameter_List`, the whole FMB generation uses `_Parameter_list`.
    // Trying only the first spelling silently reported 80 of 105 models as having no parameters at
    // all, which would have shipped a settings screen that works for a quarter of the catalogue.
    let html: string | null = null
    let page = ''
    for (const suffix of ['_Parameter_List', '_Parameter_list']) {
      page = `${model}${suffix}`
      try {
        html = await fetchPage(page, fresh)
      } catch (err) {
        warnings.push(`${model}: ${(err as Error).message}`)
        html = null
      }
      if (html !== null) break
    }
    if (html === null) { noPage.push(model); continue }
    const parsed = parseParameterList(html)
    if (Object.keys(parsed.params).length === 0) {
      warnings.push(`${model}: page fetched but no editable parameter matched — layout drift?`)
      continue
    }
    out[model] = { sourceUrl: WIKI + page, params: parsed.params }
    for (const w of parsed.warnings) warnings.push(`${model}: ${w}`)
  }

  const missing: Record<string, string[]> = {}
  for (const id of Object.keys(EDITABLE_PARAMS)) {
    const without = Object.keys(out).filter((m) => out[m]!.params[id] === undefined)
    if (without.length > 0) missing[id] = without
  }

  /**
   * A degraded run must NOT quietly replace the catalogue.
   *
   * `fetchPage` caches any 200 body, so one WAF challenge or soft-404 wave would shrink the model
   * set, write the smaller file, exit 0, and then persist the poisoned pages for every later run
   * that does not pass --fresh. Downstream that reads as "this model has no settings", which the UI
   * is designed to present as a fact. Compare against what is already committed and refuse to
   * regress unless the operator says so.
   */
  const prev = existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, 'utf8')) as { models?: Record<string, ModelParams> }).models ?? {}
    : {}
  const lostModels = Object.keys(prev).filter((m) => out[m] === undefined)
  const lostParams = Object.keys(prev)
    .filter((m) => out[m] !== undefined)
    .flatMap((m) => Object.keys(prev[m]!.params).filter((id) => out[m]!.params[id] === undefined).map((id) => `${m}/${id}`))
  const force = process.argv.includes('--accept-regression')
  if ((lostModels.length > 0 || lostParams.length > 0) && !force) {
    console.error(`REFUSING to write: this run lost ${lostModels.length} model(s) and ${lostParams.length} parameter(s) versus the committed catalogue.`)
    if (lostModels.length > 0) console.error(`  models: ${lostModels.join(', ')}`)
    if (lostParams.length > 0) console.error(`  params: ${lostParams.slice(0, 20).join(', ')}`)
    console.error('  Re-run with --fresh (the cache may hold a challenge page), or --accept-regression if the wiki genuinely dropped them.')
    process.exitCode = 1
    return
  }

  const file = {
    note: 'GENERATED by tools/avl-dict (gen:params) — do not hand-edit. Ranges come from each MODEL\'s own Parameter List page; an id absent here is absent on that model and must never be sent to it.',
    retrieved_at: new Date().toISOString().slice(0, 10),
    editable: EDITABLE_PARAMS,
    observed: OBSERVED_PARAMS,
    models: out,
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n')

  console.log(`${Object.keys(out).length} models with a parameter list; ${noPage.length} without one`)
  if (noPage.length > 0) console.log(`  no Parameter_List page: ${noPage.join(', ')}`)
  for (const [id, without] of Object.entries(missing)) {
    console.log(`  parameter ${id} (${EDITABLE_PARAMS[id]!.key}) absent on ${without.length}: ${without.slice(0, 12).join(', ')}${without.length > 12 ? ' …' : ''}`)
  }
  if (warnings.length > 0) console.error(`\n${warnings.length} warning(s):\n  ${warnings.join('\n  ')}`)
  console.log(`\nwrote ${OUT}`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
