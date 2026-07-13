import { describe, expect, it } from 'vitest'

import { pilotPayload } from '../src/components/site/PilotForm.js'
import { readRefCookie, refCookieString, refFromSearch } from '../src/lib/ref.js'

describe('W9-S1 pilot form payload (pure)', () => {
  const form = (entries: Record<string, string>) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(entries)) fd.set(k, v)
    return fd
  }

  it('builds the API body, trimming values and carrying the honeypot + ref', () => {
    const fd = form({ name: '  Jonas ', company: 'UAB X', email: 'j@x.lt', phone: '', deviceCount: '250', message: 'FMB920', hp_field: '' })
    expect(pilotPayload(fd, 'partner-1')).toEqual({
      name: 'Jonas', company: 'UAB X', email: 'j@x.lt', phone: '', deviceCount: '250', message: 'FMB920', hp_field: '', ref: 'partner-1',
    })
  })

  it('omits ref when none exists; the honeypot key is hp_field (never an autofill token)', () => {
    const p = pilotPayload(form({}), null)
    expect('ref' in p).toBe(false)
    expect('hp_field' in p).toBe(true)
    expect('website' in p).toBe(false)
    expect('url' in p).toBe(false)
  })
})

describe('W9-S1 tc_ref helpers (pure)', () => {
  it('extracts a url-safe ref from the query string, rejecting junk', () => {
    expect(refFromSearch('?ref=partner-1')).toBe('partner-1')
    expect(refFromSearch('?ref=a b')).toBeNull() // spaces = not a code
    expect(refFromSearch('?ref=<script>')).toBeNull()
    expect(refFromSearch('?x=1')).toBeNull()
    expect(refFromSearch('?ref=' + 'a'.repeat(200))).toBe('a'.repeat(64)) // clamped
  })

  it('cookie round-trip with 60-day Max-Age, SameSite=Lax and Secure', () => {
    const c = refCookieString('partner-1')
    expect(c).toContain('tc_ref=partner-1')
    expect(c).toContain(`Max-Age=${60 * 24 * 3600}`)
    expect(c).toContain('SameSite=Lax')
    expect(c).toContain('Secure')
    expect(readRefCookie('foo=bar; tc_ref=partner-1; x=y')).toBe('partner-1')
    expect(readRefCookie('foo=bar')).toBeNull()
  })

  it('a corrupted tc_ref cookie is dropped, not surfaced (would 400 the whole pilot post)', () => {
    expect(readRefCookie('tc_ref=bad value!')).toBeNull()
    expect(readRefCookie('tc_ref=' + 'a'.repeat(200))).toBeNull()
  })
})
