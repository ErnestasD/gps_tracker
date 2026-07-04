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
