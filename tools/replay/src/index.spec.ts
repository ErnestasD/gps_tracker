import { describe, expect, it } from 'vitest'
import { packageName } from './index.js'

describe('@trackcore/replay stub', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@trackcore/replay')
  })
})
