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
 * Does the wiki's HW Support column cover this model?
 *
 * The column mixes exact codes with family wildcards — "FMBXXX FMB110 FMB120 …" — so an exact-match
 * test misses every model covered only by the wildcard. `FMBXXX` matches FMB120, `FMX6XX` matches
 * FMC640. An EMPTY column is treated as "applies", because most tables leave it blank and the
 * alternative is claiming a model cannot do something the page never restricted.
 */
function hwCovers(hwSupport: string | undefined, model: string): boolean {
  if (hwSupport === undefined || hwSupport.trim() === '') return true
  const m = model.toUpperCase()
  return hwSupport
    .toUpperCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    // `[Expand]` is the wiki's collapse control, captured verbatim into 62 rows on fmb120 alone.
    // Left in, it is compiled below as a CHARACTER CLASS — a regex that matches nothing useful and
    // throws no error, which is the worst way for a token to fail.
    .filter((t) => t !== '[EXPAND]')
    .some((t) => t === m || (t.includes('X') && new RegExp(`^${t.replace(/[^A-Z0-9X]/g, '').replace(/X/g, '.')}$`).test(m)))
}

/**
 * A capability is what the DEVICE can carry, never a promise about a vehicle. Both Teltonika adapter
 * pages state that the number of CAN parameters depends on the vehicle's model, year and equipment,
 * so `can: true` means "this model has the CAN line", not "you will get engine data".
 */
function capabilitiesFor(model: string, table: string, sharedTable: boolean): Record<string, unknown> {
  const entries = Object.values(dictionaryFor(table))
  // WHEN IS THE HW COLUMN A FILTER AT ALL? Two cases where it is not, and both were shipping lies:
  //
  //  - a SINGLE-MODEL table. It was scraped from that model's OWN wiki page, so every row on it is
  //    documented for it; the HW column there names whichever family the row belongs to. Filtering
  //    denied 59 model×capability pairs — fmm880.json carries 44 BLE and 39 OBD rows and not one
  //    names FMM880 (they say `FMBXXX`, which does not match an FMM code). Worst was the pair an
  //    operator compares side by side: FMB641's page carries 196 CAN and 73 tachograph rows whose
  //    column reads "FMB640 FMC640 FMM640", so FMB641 advertised can:false / tacho:false beside
  //    FMB640's true — a false differentiator on the exact feature FMB641 exists for.
  //
  //  - a model the column NEVER names. Then it is not describing that model, and filtering by it
  //    returns a uniformly false answer rather than an answer. All 137 rows of the FM36 page read
  //    "FM3612, FM36M1"; the bare FM36 is a family label the page itself does not list, so it came
  //    back with no capabilities at all while its table carries 89 CAN rows.
  //
  // A filter that excludes everything is not evidence of absence.
  const named = entries.some((e) => (e.hwSupport ?? '').trim() !== '' && hwCovers(e.hwSupport, model))
  const filter = sharedTable && named
  const has = (groups: Set<string>): boolean =>
    entries.some((e) => groups.has((e.group ?? '').trim().toUpperCase()) && (!filter || hwCovers(e.hwSupport, model)))
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
/** How many models share each table — a table with one model IS that model's own page. */
const modelsPerTable = new Map<string, number>()
for (const m of (catalogue as { models: { model: string; dictionary: string }[] }).models) {
  modelsPerTable.set(m.dictionary, (modelsPerTable.get(m.dictionary) ?? 0) + 1)
}

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
    capabilities: capabilitiesFor(m.model, m.dictionary, modelsPerTable.get(m.dictionary)! > 1),
    presenceRules: asset ? ASSET : VEHICLE,
    commandPresets: asset ? ASSET_PRESETS : VEHICLE_PRESETS,
    readIdleMin: asset ? 1560 : 40, // 26 h for an asset tracker that reports on a schedule
  }
})

export const DEVICE_PROFILES: ProfileSeed[] = [...MODELS, ...LEGACY]

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
      if (before !== null && JSON.stringify(before.presenceRules) !== JSON.stringify(p.presenceRules)) {
        changed.push(`${p.key}: presenceRules ${JSON.stringify(before.presenceRules)} → ${JSON.stringify(p.presenceRules)}`)
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
