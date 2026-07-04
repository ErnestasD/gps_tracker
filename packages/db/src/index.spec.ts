import { describe, expect, it } from 'vitest'
import { packageName } from './index.js'

describe('@trackcore/db stub', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@trackcore/db')
  })
})
