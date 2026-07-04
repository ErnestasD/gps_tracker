import { describe, expect, it } from 'vitest'
import { packageName } from './index.js'

describe('@trackcore/redact stub', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@trackcore/redact')
  })
})
