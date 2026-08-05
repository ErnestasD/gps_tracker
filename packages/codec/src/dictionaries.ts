import fmb1xx from '../dictionaries/fmb1xx.json' with { type: 'json' }
import fmb6xx from '../dictionaries/fmb6xx.stub.json' with { type: 'json' }
import fmc from '../dictionaries/fmc.json' with { type: 'json' }
import tat from '../dictionaries/tat.json' with { type: 'json' }
import { FrameError } from './errors.js'

/**
 * AVL ID dictionaries, generated from the wiki per-model tables
 * (PROJECT_PLAN §3.7 dictionary rule). Runtime code never hardcodes AVL IDs
 * outside these files; unknown IDs pass through as `io_<id>` downstream.
 */
export type DictionaryFamily = 'fmb1xx' | 'fmc' | 'tat' | 'fmb6xx'

export interface AvlDictionaryEntry {
  name: string
  bytes: string
  type: string
  multiplier?: string
  units?: string
  description?: string
}

export interface DictionaryFile {
  family: string
  source_url: string
  retrieved_at: string
  elements: Record<string, AvlDictionaryEntry>
}

const FILES: Record<DictionaryFamily, DictionaryFile> = {
  fmb1xx,
  fmc,
  tat,
  fmb6xx,
}

const cache = new Map<DictionaryFamily, Map<number, AvlDictionaryEntry>>()

/**
 * Reinterpret a wire value as two's complement when the wiki table says the parameter is SIGNED.
 *
 * The protocol puts every IO element on the wire as raw bytes; the dictionary is what says how to
 * read them. Nothing did (audit MED), so all 36 signed parameters in the FMB1xx table surfaced as
 * unsigned: a coolant or BLE temperature of −5 °C reads as 251, and an accelerometer axis swinging
 * negative reads as ~65 000. Those go straight into `attrs`, so the customer sees them on the device
 * page, in exports, and in any rule threshold built on them — a "below −10 °C" cold-chain alert can
 * never fire, because the value it compares is never negative.
 *
 * Width comes from the dictionary's own `bytes` column, so a 1-byte and a 2-byte signed parameter
 * are each interpreted at their own width. A width we do not recognise returns the value untouched:
 * guessing is how a correct reading becomes a wrong one.
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID (Type column)
 */
export function applySign(entry: AvlDictionaryEntry | undefined, value: bigint): bigint {
  if (entry === undefined || entry.type !== 'Signed' || value < 0n) return value
  const bits = { '1': 8, '2': 16, '4': 32, '8': 64 }[entry.bytes.trim()]
  if (bits === undefined) return value
  return BigInt.asIntN(bits, value)
}

/** Validation is separate from loading so malformed shapes are unit-testable. */
export function buildDictionary(file: DictionaryFile): Map<number, AvlDictionaryEntry> {
  // provenance is mandatory (CLAUDE.md rule 8) — a dictionary without it must not load
  if (!file.source_url.startsWith('https://wiki.teltonika-gps.com/')) {
    throw new FrameError(`dictionary ${file.family}: source_url must point at the Teltonika wiki`)
  }
  if (!file.retrieved_at) {
    throw new FrameError(`dictionary ${file.family}: retrieved_at missing`)
  }
  const map = new Map<number, AvlDictionaryEntry>()
  for (const [key, entry] of Object.entries(file.elements)) {
    const id = Number(key)
    if (!Number.isInteger(id) || id < 0 || id > 0xffff) {
      throw new FrameError(`dictionary ${file.family}: invalid AVL id key '${key}'`)
    }
    if (!entry.name) {
      throw new FrameError(`dictionary ${file.family}: AVL id ${id} has no name`)
    }
    map.set(id, entry)
  }
  return map
}

export function loadDictionary(family: DictionaryFamily): Map<number, AvlDictionaryEntry> {
  const cached = cache.get(family)
  if (cached) return cached
  const map = buildDictionary(FILES[family])
  cache.set(family, map)
  return map
}
