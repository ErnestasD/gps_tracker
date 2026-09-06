import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A MapLibre marker must never declare `position` inline.
 *
 * The library places a marker by writing a transform onto an element it expects to be
 * `position: absolute`, which it supplies through `.maplibregl-marker` in its own stylesheet. An
 * inline style outranks any stylesheet, so `el.style.cssText = "…position:relative…"` quietly took
 * every marker OUT of the map's coordinate space and back into normal document flow: the elements
 * stacked one under the next, and the map's transform merely nudged each from that wrong origin.
 *
 * It looked like a plausible scatter at city zoom, which is why it survived a rewrite of this file
 * and two rounds of review, and revealed itself only zoomed out — 24 vans in a vertical column
 * across the Baltics (founder, 2026-09-06). Nothing typechecks or renders wrong; the vehicles are
 * simply not where the data says.
 *
 * The label inside a marker does not need it: `absolute` establishes a containing block exactly as
 * `relative` does.
 */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(e)) out.push(full)
  }
  return out
}

describe('MapLibre markers keep the position the library gives them', () => {
  it('no marker element sets `position` in an inline style', () => {
    const offenders: string[] = []
    for (const file of walk(join(__dirname, '..', 'src'))) {
      const src = readFileSync(file, 'utf8')
      // only files that actually build markers can commit this
      if (!/new maplibregl\.Marker/.test(src)) continue
      for (const [i, line] of src.split('\n').entries()) {
        if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) continue
        if (/\.style\.cssText\s*=/.test(line) && /position\s*:/.test(line)) {
          offenders.push(`${file.split('/src/')[1]}:${i + 1}`)
        }
        if (/\.style\.position\s*=/.test(line)) offenders.push(`${file.split('/src/')[1]}:${i + 1}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
