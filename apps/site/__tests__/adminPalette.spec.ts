import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A Tailwind colour utility that this app has no token for is a SILENT no-op.
 *
 * The demo shell is meant to be the admin shell, so the honest way to build it is to copy from
 * apps/web. But the two apps have entirely different Tailwind palettes: apps/web defines
 * --color-surface / --color-text / --color-bg / --color-line, and this app defines none of them.
 * Carrying a class name across therefore compiles, typechecks, renders, and does nothing — which is
 * how the demo shipped a fully TRANSPARENT header (`bg-surface/80`) and header controls painted in
 * the background colour (`text-muted`, where --muted here is a SURFACE, not a text grey). Twice, in
 * one afternoon, both found by the founder rather than by us.
 *
 * The shared vocabulary is the `--admin-*` tokens, which mean the same thing in both apps. This
 * fails on any class that reaches for apps/web's palette instead.
 */
const WEB_ONLY = ['surface-2', 'surface', 'text', 'bg', 'line', 'muted', 'danger', 'warn', 'info', 'success', 'accent-2', 'accent'] as const
// `bg-bg`, `text-text`, `border-line`, `bg-surface/80`, `hover:bg-surface-2`, `text-muted` …
const CLASS_RE = new RegExp(String.raw`(?:^|[\s"'\`])(?:hover:|focus:|active:|group-hover:|md:|lg:|dark:)*(?:bg|text|border|ring|fill|stroke|from|to|via|divide|placeholder|caret|outline|shadow|decoration|accent)-(${WEB_ONLY.join('|')})(?:\/\d+)?(?=[\s"'\`]|$)`, 'g')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(e)) out.push(full)
  }
  return out
}

describe('the demo never reaches for a palette it does not have', () => {
  it("no apps/web colour utility appears in this app's source", () => {
    // the palette this app actually defines, read from its own stylesheet
    const css = readFileSync(join(__dirname, '..', 'src', 'styles.css'), 'utf8')
    const defined = new Set([...css.matchAll(/--color-([a-z0-9-]+)/g)].map((m) => m[1]))
    const missing = WEB_ONLY.filter((t) => !defined.has(t))
    // guard the guard: if this app ever defines one of them, stop flagging it
    expect(missing.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of walk(join(__dirname, '..', 'src'))) {
      // comments are prose, not markup — the note explaining this very trap quotes the class it
      // forbids, and a guard that cannot survive its own documentation is not worth keeping
      const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/\S/g, ' '))
      for (const [i, line] of src.split('\n').entries()) {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue
        for (const m of line.matchAll(CLASS_RE)) {
          if (missing.includes(m[1] as (typeof WEB_ONLY)[number])) {
            offenders.push(`${file.split('/src/')[1]}:${i + 1}  ${m[0].trim()}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
