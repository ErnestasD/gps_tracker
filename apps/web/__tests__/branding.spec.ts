import { describe, expect, it } from 'vitest'

import { clampForTheme, contrast, ensureContrast, SURFACE_LIGHT_REF, SURFACE_REF } from '../src/lib/branding.js'

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

describe('theme-aware clamping (white-label follow-up)', () => {
  it('light theme darkens a too-light accent until it reads on white (≥3:1)', () => {
    const amber = '#fbbf24' // passes on the dark surface, unreadable on white
    expect(contrast(amber, SURFACE_LIGHT_REF)).toBeLessThan(3)
    const fixed = clampForTheme(amber, 'light')
    expect(fixed).not.toBe(amber)
    expect(contrast(fixed, SURFACE_LIGHT_REF)).toBeGreaterThanOrEqual(3)
  })

  it('dark theme keeps the lighten behavior (clampForTheme ≡ old ensureContrast)', () => {
    const dark = '#132038'
    expect(clampForTheme(dark, 'dark')).toBe(ensureContrast(dark))
    expect(contrast(clampForTheme(dark, 'dark'), SURFACE_REF)).toBeGreaterThan(contrast(dark, SURFACE_REF))
  })

  it('ensureContrast accepts an explicit theme and defaults to dark', () => {
    const amber = '#fbbf24'
    expect(ensureContrast(amber)).toBe(amber) // already legible on dark → untouched
    expect(ensureContrast(amber, 'light')).toBe(clampForTheme(amber, 'light'))
  })

  it('leaves an already-legible light-theme accent untouched', () => {
    const navy = '#1d4ed8' // dark blue, high contrast on white
    expect(contrast(navy, SURFACE_LIGHT_REF)).toBeGreaterThanOrEqual(3)
    expect(clampForTheme(navy, 'light')).toBe(navy)
  })

  it('worst case (white on white) stays bounded and never produces invalid hex', () => {
    // ≤4 darken steps: #ffffff → ~#858585 (≈3.7:1) — moved, valid, capped
    const clamped = clampForTheme('#ffffff', 'light')
    expect(clamped).toMatch(/^#[0-9a-f]{6}$/)
    expect(contrast(clamped, SURFACE_LIGHT_REF)).toBeGreaterThan(contrast('#ffffff', SURFACE_LIGHT_REF))
  })

  it('re-clamping for the opposite theme yields a readable color both ways', () => {
    // simulates a theme switch: same tenant hex, per-theme clamp each time
    const hex = '#fbbf24'
    expect(contrast(clampForTheme(hex, 'dark'), SURFACE_REF)).toBeGreaterThanOrEqual(3)
    expect(contrast(clampForTheme(hex, 'light'), SURFACE_LIGHT_REF)).toBeGreaterThanOrEqual(3)
  })
})
