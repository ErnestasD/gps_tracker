import type { DeviceLive, DeviceStatus } from './liveStore'

/**
 * Filtering, counting and ordering for the fleet panel.
 *
 * Named `fleetPanelCounts` rather than `fleetCounts` because `lib/dashboard.ts` already exports a
 * differently-shaped `fleetCounts`, and two same-named counters over the same fleet is how a
 * denominator quietly changes meaning.
 *
 * Pure and separate from the panel because these are the decisions an operator reads as facts —
 * "4 driving, 2 offline" is a claim about their fleet, and a counter that quietly redefines its own
 * denominator has already been a real defect here: the panel once showed "3 of 3" for a fleet of
 * eight, because devices that had never reported were not counted as devices.
 */

/** A device in the fleet that has never reported a position — no coordinate, but it exists. */
export interface SilentDevice {
  id: string
  name: string
}

/** `silent` is its own bucket: not a status the device reported, but the absence of any report. */
export type FleetFilter = 'all' | DeviceStatus | 'silent'

export interface FleetPanelCounts {
  online: number
  stale: number
  offline: number
  silent: number
  total: number
}

export function fleetPanelCounts(devices: readonly DeviceLive[], silent: readonly SilentDevice[]): FleetPanelCounts {
  const c: FleetPanelCounts = { online: 0, stale: 0, offline: 0, silent: silent.length, total: devices.length + silent.length }
  for (const d of devices) c[d.status] += 1
  return c
}

const matches = (haystack: string, q: string): boolean => haystack.toLowerCase().includes(q)

/**
 * The panel's visible set.
 *
 * Search covers whatever `label` returns — name, and the plate when the device has one — because an
 * operator looking for a vehicle knows its plate, not its device id.
 */
export function filterFleet(
  devices: readonly DeviceLive[],
  silent: readonly SilentDevice[],
  opts: { query: string; filter: FleetFilter; label: (deviceId: string) => string },
): { devices: DeviceLive[]; silent: SilentDevice[] } {
  const q = opts.query.trim().toLowerCase()
  const byQuery = q === ''
  const keptDevices = devices.filter(
    (d) => (byQuery || matches(opts.label(d.ev.deviceId), q)) && (opts.filter === 'all' || opts.filter === d.status),
  )
  const keptSilent = silent.filter(
    (d) => (byQuery || matches(d.name, q)) && (opts.filter === 'all' || opts.filter === 'silent'),
  )
  return { devices: keptDevices, silent: keptSilent }
}

export type FleetSort = 'name' | 'speed' | 'status'

/** Freshest first within a status, so the panel's top is where something is happening. */
const STATUS_RANK: Record<DeviceStatus, number> = { online: 0, stale: 1, offline: 2 }

export function sortFleet(
  devices: readonly DeviceLive[],
  sort: FleetSort,
  label: (deviceId: string) => string,
): DeviceLive[] {
  const out = [...devices]
  const byName = (a: DeviceLive, b: DeviceLive) =>
    label(a.ev.deviceId).localeCompare(label(b.ev.deviceId), undefined, { numeric: true, sensitivity: 'base' })
  switch (sort) {
    case 'speed':
      // fastest first; a null speed is not zero — it is unknown, and unknown sorts last
      return out.sort((a, b) => (b.ev.speed ?? -1) - (a.ev.speed ?? -1) || byName(a, b))
    case 'status':
      return out.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || byName(a, b))
    default:
      return out.sort(byName)
  }
}
