import { describe, expect, it } from 'vitest'

import { filterDevices, filterNav, isPaletteShortcut, shortcutLabel, type PaletteNavEntry } from '../src/lib/palette.js'

const NAV: PaletteNavEntry[] = [
  { key: 'shell.overview', to: '/app', label: 'Overview' },
  { key: 'shell.devices', to: '/app/devices', label: 'Įrenginiai' },
  { key: 'shell.map', to: '/app/map', label: 'Map' },
]

const DEVICES = [
  { id: '1', name: 'Van 25', imei: '860000000000001' },
  { id: '2', name: 'Truck A', imei: '860999999999999' },
  { id: '3', name: 'van spare', imei: '111111111111111' },
]

describe('palette filter', () => {
  it('empty query returns every nav page (quick-nav) and NO devices (never dump the fleet)', () => {
    expect(filterNav(NAV, '')).toHaveLength(3)
    expect(filterNav(NAV, '   ')).toHaveLength(3)
    expect(filterDevices(DEVICES, '')).toHaveLength(0)
  })

  it('nav matches on the translated label, case-insensitive (incl. non-ASCII)', () => {
    expect(filterNav(NAV, 'map').map((n) => n.key)).toEqual(['shell.map'])
    expect(filterNav(NAV, 'ĮRENG').map((n) => n.key)).toEqual(['shell.devices'])
    expect(filterNav(NAV, 'zzz')).toHaveLength(0)
  })

  it('devices match by name (case-insensitive) or IMEI substring', () => {
    expect(filterDevices(DEVICES, 'van').map((d) => d.id)).toEqual(['1', '3'])
    expect(filterDevices(DEVICES, '86099').map((d) => d.id)).toEqual(['2'])
    expect(filterDevices(DEVICES, 'nope')).toHaveLength(0)
  })

  it('device results honor the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: `Van ${i}`, imei: String(i) }))
    expect(filterDevices(many, 'van')).toHaveLength(6)
    expect(filterDevices(many, 'van', 3)).toHaveLength(3)
  })
})

describe('shortcut label / detection', () => {
  it('mac-family platforms show ⌘K, everything else Ctrl K', () => {
    expect(shortcutLabel('MacIntel')).toBe('⌘K')
    expect(shortcutLabel('iPhone')).toBe('⌘K')
    expect(shortcutLabel('iPad')).toBe('⌘K')
    expect(shortcutLabel('Win32')).toBe('Ctrl K')
    expect(shortcutLabel('Linux x86_64')).toBe('Ctrl K')
    expect(shortcutLabel('')).toBe('Ctrl K')
  })

  it('isPaletteShortcut accepts Cmd+K or Ctrl+K (either case), nothing else', () => {
    expect(isPaletteShortcut({ key: 'k', metaKey: true, ctrlKey: false })).toBe(true)
    expect(isPaletteShortcut({ key: 'K', metaKey: false, ctrlKey: true })).toBe(true)
    expect(isPaletteShortcut({ key: 'k', metaKey: false, ctrlKey: false })).toBe(false)
    expect(isPaletteShortcut({ key: 'j', metaKey: true, ctrlKey: false })).toBe(false)
  })
})
