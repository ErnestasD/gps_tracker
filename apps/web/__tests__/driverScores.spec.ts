import { describe, expect, it } from 'vitest'

import { scoreVariant } from '../src/lib/drivers'

describe('V2 scoreVariant', () => {
  it('maps a 0–100 score (or null) to a badge variant', () => {
    expect(scoreVariant(95)).toBe('success')
    expect(scoreVariant(80)).toBe('success')
    expect(scoreVariant(70)).toBe('warn')
    expect(scoreVariant(60)).toBe('warn')
    expect(scoreVariant(40)).toBe('danger')
    expect(scoreVariant(null)).toBe('outline')
  })
})
