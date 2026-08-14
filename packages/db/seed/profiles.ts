import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'

import catalogue from '../../codec/dictionaries/catalogue.json' with { type: 'json' }

/**
 * Device MODELS (was: four families).
 *
 * The picker offered four options while Teltonika ships ~105 trackers that have an AVL page, and the
 * profile decided nothing about decoding — `normalize()` had a defaulted dictionary and its only
 * caller passed undefined, so every device decoded against the FMB1xx table whatever an operator
 * picked. This seed is generated FROM `packages/codec/dictionaries/catalogue.json`, which the AVL
 * generator writes, so the model list and the dictionaries cannot drift apart: a model that appears
 * here always has a table, and a table always has at least one model.
 *
 * presenceRules feed the trip state machine (§6.4) and the offline sweeper (§6.5); commandPresets
 * are the Codec-12 preset grid (E08-2); readIdleMin is ingest's per-profile read-idle timeout
 * (§6.1). Idempotent upsert by key — safe to re-run. Run: pnpm db:seed:profiles.
 */

interface ProfileSeed {
  key: string
  name: string
  model?: string
  avlTable: string
  capabilities?: Record<string, unknown>
  legacy?: boolean
  presenceRules: Record<string, unknown>
  commandPresets: unknown[]
  readIdleMin: number
}

/**
 * A vehicle tracker's defaults, and an asset tracker's.
 *
 * The split is taken from the wiki's own page STRUCTURE, not from marketing copy: TAT/TMT/TST/TFT
 * and GH share one AVL template built around BLE sensor elements and battery life, and they report
 * on a schedule rather than on ignition. Everything on the FM, FT and AT pages is an ignition-wired
 * tracker. These are STARTING POINTS for trip segmentation, not claims about a model — an operator
 * who knows their fleet should be able to tune them, which is a separate piece of work.
 */
const VEHICLE = { moveSpeedKmh: 6, movingSustainS: 90, parkedIgnitionOffS: 180, idleSustainS: 120 }
const ASSET = { noIgnition: true, moveSpeedKmh: 3, movingSustainS: 300, parkedDisplaceM: 100, offlineAfterH: 26 }
const ASSET_FAMILIES = ['TAT', 'TMT', 'TST', 'TFT', 'GH5']

/** Codec-12 presets. `getinfo`/`getver`/`getgps` are the three every FM-series device answers. */
const VEHICLE_PRESETS = [
  { name: 'Get info', text: 'getinfo' },
  { name: 'Get GPS', text: 'getgps' },
  { name: 'Get version', text: 'getver' },
]
const ASSET_PRESETS = [{ name: 'Get GPS', text: 'getgps' }]

/**
 * What a model can do, derived from the wiki's own Parameter Group and HW Support columns.
 *
 * The group names are matched EXPLICITLY, never by substring. There are 52 distinct group values
 * across the 34 tables and the same concept is spelled several ways — "Bluetooth Low Energy",
 * "Bluetooth®Low Energy", "Bluetooth® Low Energy", "BLE elements", "Bluetooth accessories I/O
 * elements" — so a `group.includes('BLE')` test silently reported that almost no model has
 * Bluetooth, TAT100 included. Substring matching on a vocabulary you have not enumerated is how you
 * ship a confident, wrong answer; the list below is the enumeration.
 */
const CAN_GROUPS = new Set([
  'ALLCAN300', 'ALLCAN300, CANCONTROL', 'LVCAN200, ALLCAN300, CANCONTROL', 'LVCAN, ALLCAN300, CANCONTROL',
  'CAN ADAPTERS', 'CAN ADAPTERS ELEMENTS', 'CAN CHIP', 'MANUAL CAN', 'MANUAL CAN ELEMENTS',
  'MANUAL CAN I/O ELEMENTS', 'CAN GOVECS', 'CAN BOSCH', 'DEFAULT J1939', 'FMS ELEMENTS',
  'FMS ECO DRIVING ELEMENTS', 'EV FMS ELEMENTS', 'ISOBUS',
  // …and the ten this list MISSED, which is the point the docblock above makes about
  // enumeration: `ALLCAN300/LVCAN200 I/O ELEMENTS` is fm36's spelling, and its absence reported
  // FM36/FM3612/FM36M1 as can:false while their table carries 89 CAN rows. An incomplete
  // enumeration is a substring match with extra steps.
  'ALLCAN300/LVCAN200 I/O ELEMENTS', 'LVCAN200, CANCONTROL', 'LV-CAN200 + DTC', 'CANCONTROL',
  'LVCAN, ALLCAN300', 'LVCAN', 'LVCAN ELEMENTS', 'EUROSCAN IO', 'TRANSCAN IO', 'CAN ASKOLL',
])
const BLE_GROUPS = new Set([
  'BLUETOOTH LOW ENERGY', 'BLUETOOTH®LOW ENERGY', 'BLUETOOTH® LOW ENERGY', 'BLE ELEMENTS',
  'BLUETOOTH ACCESSORIES I/O ELEMENTS',
])
const TACHO_GROUPS = new Set(['TACHOGRAPH DATA ELEMENTS', 'TACHO'])
const OBD_GROUPS = new Set(['OBD ELEMENTS', 'OBD OEM ELEMENTS'])

/**
 * A capability is what the DEVICE can carry, never a promise about a vehicle. Both Teltonika adapter
 * pages state that the number of CAN parameters depends on the vehicle's model, year and equipment,
 * so `can: true` means "this model has the CAN line", not "you will get engine data".
 */
function capabilitiesFor(table: string): Record<string, unknown> {
  const entries = Object.values(dictionaryFor(table))
  // WHAT THIS ACTUALLY ANSWERS: "does this model's AVL table document any elements of this group?"
  //
  // It does NOT consult the HW Support column, and the three formulations that tried to are gone,
  // because the last of them was a TAUTOLOGY and review proved it: with
  // `discriminates = rows.some(hwNonEmpty && hwCovers)` the expression
  // `rows.some(e => !discriminates || hwCovers(e))` is true whenever `rows` is non-empty — if
  // `discriminates` is false the left side short-circuits, and if it is true the very row that
  // witnessed it satisfies `hwCovers`. Measured over all 105 models × 4 groups: 420 of 420
  // evaluations equal `rows.length > 0`. Twenty-five lines of comment described a filter that never
  // ran once.
  //
  // The honest question is whether to implement the filter for real, and the answer is no. A strict
  // per-group HW filter changes 60 (model, capability) answers across 31 models — and for 54 of
  // those 60 the column names the model elsewhere on the same page, so "the column excludes it" is
  // a real exclusion, not missing information. Honouring it would re-deny FMM880 its BLE, FMB641 its
  // CAN and tachograph, and FM36 its CAN: exactly the wrong answers earlier rounds fixed. The AVL
  // page simply does not answer at SKU granularity, and pretending otherwise is how the last three
  // formulations went wrong.
  //
  // So this is a TABLE-LEVEL claim, and the field should be read that way: "the dictionary that
  // decodes this model documents CAN/BLE/tacho/OBD elements". Two models that share a table always
  // get the same answer, by construction and by design. Nothing renders these flags today; putting
  // them in front of a customer needs a source that answers per SKU, which this is not.
  const has = (groups: Set<string>): boolean =>
    entries.some((e) => groups.has((e.group ?? '').trim().toUpperCase()))

  return { can: has(CAN_GROUPS), ble: has(BLE_GROUPS), tacho: has(TACHO_GROUPS), obd: has(OBD_GROUPS) }
}

/** Read a generated dictionary once, for the capability derivation above. */
const dictCache = new Map<string, Record<string, { group?: string; hwSupport?: string }>>()
function dictionaryFor(table: string): Record<string, { group?: string; hwSupport?: string }> {
  const hit = dictCache.get(table)
  if (hit) return hit
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'codec', 'dictionaries', `${table}.json`)
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { elements: Record<string, { group?: string; hwSupport?: string }> }
  dictCache.set(table, parsed.elements)
  return parsed.elements
}

/**
 * The four pre-catalogue rows. KEPT, not deleted: live devices reference them by id, so removing
 * them would orphan a fleet. They are hidden from the picker and now point at the table that
 * actually decodes them — until this change `tat-asset` and `fmb6xx-stub` devices were being
 * decoded as FMB1xx, which is mislabelling rather than missing data.
 */
const LEGACY: ProfileSeed[] = [
  { key: 'fmb1xx', name: 'Teltonika FMB1xx (vehicle)', avlTable: 'fmb120', legacy: true, presenceRules: VEHICLE, commandPresets: VEHICLE_PRESETS, readIdleMin: 40 },
  { key: 'fmc', name: 'Teltonika FMC (CAN vehicle)', avlTable: 'fmb120', legacy: true, presenceRules: VEHICLE, commandPresets: VEHICLE_PRESETS, readIdleMin: 40 },
  { key: 'fmb6xx-stub', name: 'Teltonika FMB6xx (stub)', avlTable: 'fmb640', legacy: true, presenceRules: VEHICLE, commandPresets: [{ name: 'Get version', text: 'getver' }], readIdleMin: 40 },
  { key: 'tat-asset', name: 'Teltonika TAT (asset tracker)', avlTable: 'tat100', legacy: true, presenceRules: ASSET, commandPresets: ASSET_PRESETS, readIdleMin: 1560 },
]

/** One profile per model the AVL generator found a table for. */
const MODELS: ProfileSeed[] = (catalogue as { models: { model: string; dictionary: string }[] }).models.map((m) => {
  // The prefix list is a PRODUCT classification — TAT/TMT/TST/TFT/GH tables do carry id 239, but
  // those trackers are battery-powered and nobody wires their ignition, so they run in noIgnition
  // mode by default. What follows it is a HARD derivation from the table, and it is not cosmetic:
  // a table with no id 239 at all cannot drive the ignition branch of the trip engine
  // (`engine.ts`: `t.noIgnition ? speed > … : r.ignition === true && …`), so `moving` stays false
  // forever — no trip, no distance, no report, ever. ATC700/ATM700 are exactly that: 40 ids of
  // battery voltage, alarm button and last-fix age, and the prefix list did not know about them.
  const asset = ASSET_FAMILIES.some((f) => m.model.startsWith(f)) || dictionaryFor(m.dictionary)['239'] === undefined
  return {
    key: m.model.toLowerCase(),
    name: `Teltonika ${m.model}`,
    model: m.model,
    avlTable: m.dictionary,
    capabilities: capabilitiesFor(m.dictionary),
    presenceRules: asset ? ASSET : VEHICLE,
    commandPresets: asset ? ASSET_PRESETS : VEHICLE_PRESETS,
    readIdleMin: asset ? 1560 : 40, // 26 h for an asset tracker that reports on a schedule
  }
})

export const DEVICE_PROFILES: ProfileSeed[] = [...MODELS, ...LEGACY]

/** Key-order-independent JSON serialisation, so a comparison is about values. */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
}
const sameJson = (a: unknown, b: unknown): boolean => stable(a) === stable(b)

export async function seedProfiles(databaseUrl: string): Promise<Record<string, string>> {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    const idByKey: Record<string, string> = {}
    const changed: string[] = []
    for (const p of DEVICE_PROFILES) {
      const presenceRules = p.presenceRules as never
      const commandPresets = p.commandPresets as never
      const shared = {
        name: p.name,
        presenceRules,
        commandPresets,
        readIdleMin: p.readIdleMin,
        avlTable: p.avlTable,
        capabilities: (p.capabilities ?? {}) as never,
        legacy: p.legacy ?? false,
        ...(p.model !== undefined ? { model: p.model } : {}),
      }
      // The seed OVERWRITES on re-run, deliberately: it is how a corrected classification reaches
      // an existing deployment (ATC700 moving from vehicle to asset rules is exactly that). But it
      // is also the only channel an operator has for a wrong decode today — there is no profile
      // editor — so a re-seed silently reverting `UPDATE device_profiles SET "avlTable"=…` would
      // un-fix their fix with no output at all. It still reverts; it no longer does it in silence.
      const before = await prisma.deviceProfile.findUnique({ where: { key: p.key }, select: { avlTable: true, presenceRules: true } })
      if (before !== null && before.avlTable !== p.avlTable) {
        changed.push(`${p.key}: avlTable ${before.avlTable} → ${p.avlTable}`)
      }
      // Compared by VALUE, not by serialisation. `JSON.stringify` is key-ORDER sensitive and
      // Postgres returns jsonb with its own ordering, so every deploy reported ~20 profiles as
      // "changed" when nothing had. A change report that fires on every run is worse than none: it
      // buries the one line that matters — an operator's manual correction being reverted — under
      // twenty that do not. That is the whole reason this report exists.
      if (before !== null && !sameJson(before.presenceRules, p.presenceRules)) {
        changed.push(`${p.key}: presenceRules ${stable(before.presenceRules)} → ${stable(p.presenceRules)}`)
      }
      const row = await prisma.deviceProfile.upsert({
        where: { key: p.key },
        create: { key: p.key, ...shared },
        update: shared,
      })
      idByKey[p.key] = row.id
    }
    if (changed.length > 0) {
      console.error(`profile seed CHANGED ${changed.length} existing value(s) — if one of these was a manual correction, it has just been reverted:`)
      for (const c of changed) console.error(`  ${c}`)
    }
    return idByKey
  } finally {
    await prisma.$disconnect()
  }
}

const isEntrypoint = process.argv[1]?.endsWith('seed/profiles.ts') ?? false
if (isEntrypoint) {
  const url = process.env['DATABASE_URL'] ?? 'postgresql://postgres:orbetra_dev@127.0.0.1:5432/orbetra'
  seedProfiles(url)
    .then((ids) => console.log(JSON.stringify(ids)))
    .catch((err: unknown) => {
      console.error(err)
      process.exit(1)
    })
}
