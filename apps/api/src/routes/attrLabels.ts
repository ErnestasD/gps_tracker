import { parseMultiplier, type AvlDictionaryEntry } from '@orbetra/codec'
import type { AttrLabel } from '@orbetra/shared'

/**
 * Describe every element the device actually sent, from the table that device speaks.
 *
 * Two problems, one lookup. The pipeline keeps an id-key whenever the dictionary name is ambiguous
 * within the table (37 and 81 are both "Vehicle Speed"; 48, 84 and 89 are all "Fuel Level"), so an
 * operator read "AVL 84 — 180" for 18.0 litres of fuel. And a NAMED key is no better off: the value
 * is stored raw, so `Engine Total Hours (counted)` showed a bare "47" for 47 MINUTES and
 * `Fuel Consumed Counted` showed "10" for 1.0 litre. Both read as plain, wrong numbers.
 *
 * So the units and multiplier travel with every element, named or not. The browser cannot do this
 * lookup: the same id is a fuel level on one table and an axle weight on another, and only the
 * server knows which table this device speaks.
 *
 * Pure and separate from the route so the mapping is testable without a database: it is the middle
 * of a chain — generator, wire, renderer — whose ends were each provable on their own.
 */
export function attrLabelsFor(dict: Map<number, AvlDictionaryEntry> | undefined, keys: string[]): Record<string, AttrLabel> {
  const out: Record<string, AttrLabel> = {}
  if (dict === undefined) return out
  // name → entry, for the keys the pipeline stored under their name. A name that is ambiguous in the
  // table was never stored as a name (it became `io_<id>`), so the last writer winning here cannot
  // mislabel anything the pipeline actually produces.
  const byName = new Map([...dict.values()].map((e) => [e.name, e]))
  for (const key of keys) {
    const m = /^io_(\d+)$/.exec(key)
    const entry = m === null ? byName.get(key) : dict.get(Number(m[1]))
    if (entry === undefined) continue
    // the wiki writes the multiplier in two decimal conventions and 29% of cells are not numbers at
    // all; `parseMultiplier` is the one place that is decided, and it refuses rather than guesses.
    // A refused cell means the value is shown exactly as sent.
    const mult = parseMultiplier(entry.multiplier)
    out[key] = {
      name: entry.name,
      ...(entry.units !== undefined ? { units: entry.units } : {}),
      // an explicit `null` is the refusal state and must survive the wire, so this tests for
      // `undefined` rather than truthiness
      ...(entry.unitAfterMultiplier !== undefined ? { unitAfterMultiplier: entry.unitAfterMultiplier } : {}),
      ...(mult !== null ? { multiplier: mult } : {}),
      /**
       * The wiki's own "Parameter Group" and "Max" cells, passed through UNINTERPRETED.
       *
       * `group` is how the list is split into what the VEHICLE reports (CAN/OBD/tachograph) and what
       * the TRACKER reports about itself — Teltonika's own classification, which beats any keyword
       * list we would maintain against the element names.
       *
       * `max` is the discriminator for decoding a bitmask, and it has to travel because the name
       * alone is not enough to identify one: "Door Status" is a 2-byte, max-16128 door bitmask on
       * fmc150 (id 90) AND a 1-byte, max-255 Reefer IO element on fmb640 (id 10355). Decoding the
       * second with the first's layout would invent a reading.
       */
      ...(entry.group !== undefined ? { group: entry.group } : {}),
      ...(entry.max !== undefined ? { max: entry.max } : {}),
    }
  }
  return out
}
