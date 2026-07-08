import { describe, expect, it } from 'vitest'

import { contrast, ensureContrast, SURFACE_REF } from '../src/lib/branding.js'

/**
 * White-label theming math (E03-5). No DOM: we test the pure WCAG contrast
 * helpers that back applyBranding's auto-lighten fallback. A tenant that picks a
 * near-black accent must not vanish against the dark app surface.
 */
describe('branding contrast fallback', () => {
  it('contrast is symmetric and ≥1', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrast('#111a2e', '#111a2e')).toBeCloseTo(1, 5)
  })

  it('lightens a too-dark accent until it reads on the surface (≥3:1) or gives up', () => {
    const dark = '#132038' // barely brighter than the surface → fails 3:1
    expect(contrast(dark, SURFACE_REF)).toBeLessThan(3)
    const fixed = ensureContrast(dark)
    expect(fixed).not.toBe(dark) // it moved
    // either it reached AA, or it hit the iteration cap having only lightened
    expect(contrast(fixed, SURFACE_REF)).toBeGreaterThan(contrast(dark, SURFACE_REF))
  })

  it('leaves an already-legible accent untouched', () => {
    const bright = '#4da3ff' // default accent, high contrast on dark
    expect(contrast(bright, SURFACE_REF)).toBeGreaterThanOrEqual(3)
    expect(ensureContrast(bright)).toBe(bright)
  })

  it('never produces an invalid hex', () => {
    expect(ensureContrast('#010101')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
