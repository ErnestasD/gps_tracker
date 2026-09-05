import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { expiryLabel, shareUrl } from '../src/lib/share'

describe('V1-nice share helpers', () => {
  it('shareUrl composes the /s/<token> URL on the given origin (trailing slash tolerant)', () => {
    expect(shareUrl('abc123', 'https://dash.orbetra.com')).toBe('https://dash.orbetra.com/s/abc123')
    expect(shareUrl('abc123', 'https://dash.orbetra.com/')).toBe('https://dash.orbetra.com/s/abc123')
  })

  it('expiryLabel buckets to min/hour/day and flags expired', () => {
    const now = Date.parse('2026-07-14T12:00:00Z')
    expect(expiryLabel('2026-07-14T12:30:00Z', now)).toEqual({ expired: false, unit: 'min', value: 30 })
    expect(expiryLabel('2026-07-14T15:00:00Z', now)).toEqual({ expired: false, unit: 'hour', value: 3 })
    expect(expiryLabel('2026-07-17T12:00:00Z', now)).toEqual({ expired: false, unit: 'day', value: 3 })
    // past / equal / garbage → expired
    expect(expiryLabel('2026-07-14T11:59:00Z', now).expired).toBe(true)
    expect(expiryLabel('2026-07-14T12:00:00Z', now).expired).toBe(true)
    expect(expiryLabel('not-a-date', now).expired).toBe(true)
    // under a minute floors to at-least-1 min (never "0 min" while still valid)
    expect(expiryLabel('2026-07-14T12:00:30Z', now)).toEqual({ expired: false, unit: 'min', value: 1 })
  })
})

/**
 * The cascade trap that blanked the public share page (founder, 2026-09-05).
 *
 * `mapbox-gl.css` sets `.mapboxgl-map { position: relative }` on whatever div it mounts into, and
 * that rule is UNLAYERED while Tailwind v4's `.absolute` lives in `@layer utilities`. Unlayered CSS
 * beats layered CSS regardless of specificity or source order, so a container sized by
 * `absolute inset-0` silently collapses to zero height — header and marker fine, canvas present,
 * not one tile ever requested. It is invisible to jsdom and to typecheck, which is why it reached
 * the one surface customers see without logging in, and why the rule is asserted over the SOURCE.
 */
describe('map containers never size themselves by position', () => {
  it('every mapbox container div uses explicit height/width', () => {
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const e of readdirSync(dir)) {
        const full = join(dir, e)
        if (statSync(full).isDirectory()) out.push(...walk(full))
        else if (/\.tsx?$/.test(e)) out.push(full)
      }
      return out
    }
    const offenders: string[] = []
    for (const file of walk(join(__dirname, '..', 'src'))) {
      const src = readFileSync(file, 'utf8')
      for (const line of src.split('\n')) {
        // the div a map is mounted into is the one carrying the container ref
        if (!/ref=\{containerRef\}/.test(line)) continue
        if (/\babsolute\b|\binset-0\b/.test(line)) offenders.push(`${file.split('/src/')[1]}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
