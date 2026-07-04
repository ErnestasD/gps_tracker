import { describe, expect, it } from 'vitest'
import { packageName } from './index.js'

describe('@orbetra/codec stub', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@orbetra/codec')
  })
})
