import { describe, expect, it } from 'vitest'
import { packageName } from './index.js'

describe('@trackcore/ingest stub', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@trackcore/ingest')
  })
})
