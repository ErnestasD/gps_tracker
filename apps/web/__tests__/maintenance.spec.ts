import { describe, expect, it } from 'vitest'

import { dueVariant } from '../src/lib/maintenance'

describe('V2 maintenance helpers', () => {
  it('dueVariant maps status → badge variant', () => {
    expect(dueVariant('overdue')).toBe('danger')
    expect(dueVariant('due_soon')).toBe('warn')
    expect(dueVariant('ok')).toBe('success')
    expect(dueVariant('unknown')).toBe('outline')
  })
})
