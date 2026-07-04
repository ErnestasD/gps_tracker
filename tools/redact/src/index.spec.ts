import { describe, expect, it } from 'vitest'
import { packageName } from './index.js'

describe('@orbetra/redact stub', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@orbetra/redact')
  })
})
