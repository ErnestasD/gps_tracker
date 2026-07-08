import { describe, expect, it } from 'vitest'

import { auditQuery } from '../src/lib/audit.js'

/** Audit filter → query string (E03-6). Pure; empty values must never appear. */
describe('auditQuery', () => {
  it('omits empty/undefined filters entirely', () => {
    expect(auditQuery({})).toBe('')
    expect(auditQuery({ entity: '', action: '' })).toBe('')
  })

  it('serializes present filters', () => {
    expect(auditQuery({ entity: 'device', action: 'delete' })).toBe('?entity=device&action=delete')
    expect(auditQuery({ limit: 50, cursor: '123' })).toBe('?cursor=123&limit=50')
  })

  it('encodes ISO timestamps safely', () => {
    const q = auditQuery({ from: '2026-07-01T00:00:00.000Z' })
    expect(q).toContain('from=2026-07-01T00%3A00%3A00.000Z')
  })
})
