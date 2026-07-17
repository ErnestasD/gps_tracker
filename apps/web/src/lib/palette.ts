/**
 * Command-palette helpers (ADR-028 round 2, topbar ⌘K search). Pure — unit-tested.
 * The palette itself (components/admin/CommandPalette.tsx) only wires these to React.
 */

export interface PaletteNavEntry {
  /** nav i18n key (shell.*) — also the stable part of the cmdk-item-{key} testid */
  key: string
  to: string
  /** translated label (filtering matches what the user sees) */
  label: string
}

export interface PaletteDeviceEntry {
  id: string
  name: string
  imei: string
}

/** Keyboard-shortcut chip text for the platform string (navigator.platform). */
export function shortcutLabel(platform: string): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘K' : 'Ctrl K'
}

/** True when a keydown is the palette shortcut (Cmd+K on mac, Ctrl+K elsewhere). */
export function isPaletteShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
}

/** Nav pages matching the query (all of them for an empty query — the palette doubles as quick-nav). */
export function filterNav(items: PaletteNavEntry[], query: string): PaletteNavEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return items
  return items.filter((i) => i.label.toLowerCase().includes(q))
}

/** Devices matching the query by name or IMEI. Empty query matches nothing (never dump the fleet). */
export function filterDevices(devices: PaletteDeviceEntry[], query: string, limit = 6): PaletteDeviceEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  return devices.filter((d) => d.name.toLowerCase().includes(q) || d.imei.includes(q)).slice(0, limit)
}
