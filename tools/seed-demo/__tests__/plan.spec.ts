import { describe, expect, it } from 'vitest'

import { DEMO_DEVICES, planDemoFleet } from '../src/plan.js'

const NOW = Date.UTC(2026, 6, 10, 12, 0, 0)

describe('E08-5 planDemoFleet (pure)', () => {
  const { devices, drives } = planDemoFleet(NOW)

  it('is deterministic and produces the fixed demo fleet', () => {
    expect(devices).toHaveLength(DEMO_DEVICES)
    expect(planDemoFleet(NOW)).toEqual({ devices, drives })
  })

  it('every imei is a unique synthetic 15-digit 867… value (rule 12 — never real hardware)', () => {
    const imeis = devices.map((d) => d.imei)
    expect(new Set(imeis).size).toBe(DEMO_DEVICES)
    for (const imei of imeis) expect(imei).toMatch(/^867\d{12}$/)
  })

  it('splits the fleet across both demo accounts with demo-able special devices', () => {
    expect(devices.filter((d) => d.account === 0).length).toBeGreaterThan(0)
    expect(devices.filter((d) => d.account === 1).length).toBeGreaterThan(0)
    expect(devices.filter((d) => d.kind === 'panic')).toHaveLength(1)
    expect(devices.filter((d) => d.kind === 'invalidFix')).toHaveLength(1)
  })

  it('drives are chronological, strictly in the past, and cover every device across 3 days', () => {
    for (const d of drives) expect(d.startMs).toBeLessThan(NOW)
    for (let i = 1; i < drives.length; i++) expect(drives[i]!.startMs).toBeGreaterThanOrEqual(drives[i - 1]!.startMs)
    const perDevice = new Map<string, number>()
    for (const d of drives) perDevice.set(d.imei, (perDevice.get(d.imei) ?? 0) + 1)
    expect(perDevice.size).toBe(DEMO_DEVICES) // every device drove
    for (const [imei, n] of perDevice) {
      const spec = devices.find((x) => x.imei === imei)!
      expect(n, imei).toBe(6 + (spec.kind === 'normal' ? 0 : 1)) // 2×3 days (+1 special scenario)
    }
    const spanMs = drives[drives.length - 1]!.startMs - drives[0]!.startMs
    expect(spanMs).toBeGreaterThan(2 * 24 * 3_600_000) // history really spans days
  })

  it('special scenarios target their designated devices', () => {
    const panicDrive = drives.find((d) => d.scenario === 'panic')!
    const invalidDrive = drives.find((d) => d.scenario === 'invalidFix')!
    expect(devices.find((x) => x.imei === panicDrive.imei)!.kind).toBe('panic')
    expect(devices.find((x) => x.imei === invalidDrive.imei)!.kind).toBe('invalidFix')
  })
})
