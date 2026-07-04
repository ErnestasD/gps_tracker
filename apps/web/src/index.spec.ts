import { describe, expect, it } from 'vitest'
import { packageName } from './index.js'

describe('@trackcore/web stub', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@trackcore/web')
  })
})
