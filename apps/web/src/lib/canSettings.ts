import { getJson, mutate } from './client'

/**
 * Per-device CAN element client (founder, 2026-09).
 *
 * The problem this exists for: on a Teltonika device EVERY CAN element ships with priority 0, which
 * means "do not send". A customer whose CAN bus is wired correctly and working therefore sees about
 * six parameters in the dashboard and concludes the adapter is broken. It is not — nothing has been
 * switched on. This screen is the switch.
 *
 * Two facts govern everything below:
 *
 *  - priority IS the on/off state. 0 = not sent, 1 = low, 2 = high, 3 = panic. There is no separate
 *    enable flag on the device, so "turn off" is literally "set priority 0".
 *  - a change is QUEUED, never applied. The API turns it into a Codec 12 command that reaches the
 *    device the next time it connects — which on a vehicle parked over a weekend is days. Nothing in
 *    this module or its screen may say "saved".
 */

/** 0 = do not send (the factory value for every element), 1 = low, 2 = high, 3 = panic. */
export type CanPriority = 0 | 1 | 2 | 3

export interface CanElement {
  /** Teltonika parameter id, e.g. "45100" — the first id of the element's 6-id block. */
  param: string
  /** The element's name as the API knows it (English, from the model's parameter list). */
  name: string
  enabled: boolean
  priority: number
}

export interface CanElementsResponse {
  /** false for a model with no CAN element block at all — an honest empty state, not zero toggles. */
  supported: boolean
  elements: CanElement[]
}

/**
 * The priority a freshly-switched-on element gets.
 *
 * Low, not high: high/panic change how the device BATCHES records (a high-priority element can force
 * an immediate send), so switching fourteen parameters on at "high" would multiply a customer's
 * mobile data without them asking for it. Low means "include this in the record you were sending
 * anyway", which is exactly what the founder is asking for.
 */
export const DEFAULT_ON_PRIORITY: CanPriority = 1

export const getCanElements = (deviceId: string) =>
  getJson<unknown>(`/v1/devices/${encodeURIComponent(deviceId)}/can-elements`).then(parseCanElements)

export const saveCanElements = (deviceId: string, changes: Record<string, number>) =>
  mutate<{ queued: boolean; commandId: string }>(
    'POST',
    `/v1/devices/${encodeURIComponent(deviceId)}/can-elements`,
    { changes },
  )

/**
 * Validate the body before the screen believes a word of it.
 *
 * This is not defensive habit. One path away sits `/v1/devices/:id/can`, the older engine-snapshot
 * read, and the two were briefly registered on the SAME path — Hono matched the snapshot first and
 * this screen never saw a settings body at all. A snapshot has no `supported` field, so a trusting
 * parse would read `supported === undefined`, take the falsy branch, and tell a customer whose CAN
 * bus demonstrably works that their model "has no CAN elements". Throwing instead puts the screen
 * into its load-error state, which is the truth: we did not get an answer we understand. The paths
 * are separate now; the guard stays, because a rolling deploy can still serve the older shape.
 */
export function parseCanElements(body: unknown): CanElementsResponse {
  if (body === null || typeof body !== 'object') throw new Error('CAN elements: not an object')
  const b = body as { supported?: unknown; elements?: unknown }
  if (typeof b.supported !== 'boolean') throw new Error('CAN elements: no `supported` flag')
  if (!Array.isArray(b.elements)) throw new Error('CAN elements: no `elements` array')
  const elements: CanElement[] = []
  for (const raw of b.elements) {
    if (raw === null || typeof raw !== 'object') throw new Error('CAN elements: bad element')
    const e = raw as { param?: unknown; name?: unknown; enabled?: unknown; priority?: unknown }
    if (typeof e.param !== 'string' || typeof e.name !== 'string') throw new Error('CAN elements: bad element')
    if (typeof e.enabled !== 'boolean' || typeof e.priority !== 'number') throw new Error('CAN elements: bad element')
    elements.push({ param: e.param, name: e.name, enabled: e.enabled, priority: e.priority })
  }
  return { supported: b.supported, elements }
}

/**
 * The elements a passenger car or van actually reports, in the order an operator looks for them.
 *
 * The model catalogue lists 83 CAN elements and the long tail is tachograph fields, combine-harvester
 * telemetry and eleven kinds of road salt. Presenting those as one flat 83-row list is not a settings
 * screen — it is a parameter dump that guarantees the customer switches nothing on. So the fourteen
 * that matter come first, and the remaining sixty-nine live behind a disclosure.
 *
 * Order is deliberate (what you look for, roughly in that order), not numeric.
 */
export const PRIMARY_CAN_PARAMS: readonly string[] = [
  '45100', // Vehicle Speed
  '45140', // Engine RPM
  '45150', // Total Mileage
  '45130', // Fuel Level (liters)
  '45160', // Fuel Level (percent)
  '45110', // Acceleration Pedal Position (percent)
  '45270', // Engine Load (percent)
  '45280', // Engine Temperature
  '45170', // Door Status
  '45340', // Control State Flags
  '45430', // Security State Flags
  // the three "counted" totals — the device's own running counters, which is what an odometer or a
  // fuel report is built from when the raw total resets with the ECU
  '45220', // Total Mileage (counted)
  '45210', // Engine Worktime (counted)
  '45230', // Fuel Consumed (counted)
]

const PRIMARY_ORDER = new Map(PRIMARY_CAN_PARAMS.map((p, i) => [p, i]))

/**
 * Split the model's elements into the shortlist and the rest.
 *
 * Driven by what the API actually returned, never by the constant: a model that does not carry
 * `45130` must not gain a toggle for it here, and a model that carries an element we have never
 * heard of must still be switchable. The shortlist orders; it does not invent.
 */
export function groupCanElements(elements: readonly CanElement[]): { primary: CanElement[]; more: CanElement[] } {
  const primary = elements
    .filter((e) => PRIMARY_ORDER.has(e.param))
    .sort((a, b) => (PRIMARY_ORDER.get(a.param) ?? 0) - (PRIMARY_ORDER.get(b.param) ?? 0))
  const more = elements.filter((e) => !PRIMARY_ORDER.has(e.param))
  return { primary, more }
}

/** Whether a row's switch is on: the customer's unsaved intent, else what the device holds. */
export const isOn = (e: CanElement, draft: Readonly<Record<string, boolean>>): boolean =>
  draft[e.param] ?? e.enabled

/**
 * The priority to send when an element is switched back on.
 *
 * An element the customer switches OFF and then ON again must come back at the priority it had, not
 * be silently demoted to low. The device reports 0 once it is off, so the pre-change priority is
 * only knowable from the response we loaded the screen with — which is exactly what `e.priority`
 * still is while the draft is unsaved.
 */
export const onPriority = (e: CanElement): CanPriority =>
  e.priority === 2 || e.priority === 3 ? e.priority : DEFAULT_ON_PRIORITY

/**
 * What to POST: only the elements whose switch differs from what the device holds.
 *
 * The same rule the tracking-settings card learned the hard way. Sending all 83 every time would
 * queue an 83-parameter Codec 12 command for a customer who flipped one switch, and re-send values
 * the device already has — on a parked vehicle that is a day of "queued" badges for a change that
 * changes nothing. Flipping a switch off and back on again therefore yields an EMPTY change set, and
 * the Save button correctly disarms.
 */
export function canChanges(
  elements: readonly CanElement[],
  draft: Readonly<Record<string, boolean>>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of elements) {
    const want = draft[e.param]
    if (want === undefined || want === e.enabled) continue
    out[e.param] = want ? onPriority(e) : 0
  }
  return out
}

/** How many of the model's elements are switched on, counting the customer's unsaved edits. */
export const enabledCount = (
  elements: readonly CanElement[],
  draft: Readonly<Record<string, boolean>>,
): number => elements.filter((e) => isOn(e, draft)).length
