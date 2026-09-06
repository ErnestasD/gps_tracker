import { Link } from '@tanstack/react-router'
import { Info, Lightbulb, TriangleAlert } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'

import { resolveLink, withProduct, type KbBlock, type KbCalloutTone, type KbDoc } from '@orbetra/kb'

import { kbPath } from '@/lib/kb'

/**
 * Renders a knowledge-base document INSIDE the dashboard.
 *
 * Same content, same markup subset and same link resolver as the public site — but a different
 * surface, and that difference is the whole point of the resolver: `app:` links become real
 * navigation here, `site:` links (our pricing, our signup) render as plain text so there is no
 * href to leak into a reseller's dashboard, and `{product}` becomes whatever this deployment is
 * called. Colours come from the --admin-* tokens, so a tenant's theme applies to the help too.
 */
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[(.+?)\]\(([^)]+)\)/g

function renderInline(text: string, product: string): ReactNode {
  const source = withProduct(text, product)
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  let i = 0
  while ((m = INLINE.exec(source)) !== null) {
    if (m.index > last) out.push(source.slice(last, m.index))
    if (m[1] !== undefined) {
      out.push(<strong key={i} className="font-semibold" style={{ color: 'var(--admin-ink)' }}>{m[1]}</strong>)
    } else if (m[2] !== undefined) {
      out.push(
        <code key={i} className="mono rounded px-1 py-0.5 text-[0.9em]" style={{ background: 'var(--admin-surface-sunken)', color: 'var(--admin-ink)' }}>
          {m[2]}
        </code>,
      )
    } else if (m[3] !== undefined && m[4] !== undefined) {
      out.push(<InlineLink key={i} href={m[4]} label={m[3]} />)
    }
    last = INLINE.lastIndex
    i++
  }
  if (last < source.length) out.push(source.slice(last))
  return out.length === 1 ? out[0] : out.map((n, k) => <Fragment key={k}>{n}</Fragment>)
}

function InlineLink({ href, label }: { href: string; label: string }) {
  const target = resolveLink(href, 'app')
  const cls = 'underline-offset-2 hover:underline'
  const style = { color: 'var(--admin-brand)' }
  switch (target.kind) {
    case 'article':
      // `to` is typed as a literal union in this router; the help route is the one place a path is
      // built from data, so it goes through the string form deliberately.
      return <Link to={kbPath(target.slug)} className={cls} style={style}>{label}</Link>
    case 'screen':
      return <Link to={target.path} className={cls} style={style}>{label}</Link>
    case 'external':
      return <a href={target.href} target="_blank" rel="noreferrer noopener" className={cls} style={style}>{label}</a>
    default:
      // `site:` — a page on the public marketing site. NEVER a link here: on a reseller's domain
      // that href is our brand, in their product, one click from their customer.
      return <strong className="font-semibold" style={{ color: 'var(--admin-ink)' }}>{label}</strong>
  }
}

const CALLOUT: Record<KbCalloutTone, { icon: typeof Info; token: string }> = {
  note: { icon: Info, token: '--admin-info' },
  tip: { icon: Lightbulb, token: '--admin-success' },
  warning: { icon: TriangleAlert, token: '--admin-warning' },
}

function Block({ b, product }: { b: KbBlock; product: string }) {
  const ink = { color: 'var(--admin-ink)' }
  const soft = { color: 'var(--admin-ink-soft)' }
  // scroll-mt clears the sticky topbar when arriving via a #fragment from a contextual help link
  if (b.h2 !== undefined) return <h2 id={b.id} className="display mt-8 mb-2 scroll-mt-20 text-lg font-semibold first:mt-0" style={ink}>{b.h2}</h2>
  if (b.callout !== undefined) {
    const { icon: Icon, token } = CALLOUT[b.callout]
    return (
      <div className="mt-4 flex gap-2.5 rounded-lg border px-3.5 py-3" style={{ borderColor: `var(${token})`, background: `var(${token}-soft)` }}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: `var(${token})` }} aria-hidden />
        <p className="text-sm leading-relaxed" style={ink}>{renderInline(b.p ?? '', product)}</p>
      </div>
    )
  }
  if (b.p !== undefined) return <p className="mt-3 text-sm leading-relaxed" style={soft}>{renderInline(b.p, product)}</p>
  if (b.ul !== undefined)
    return <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed" style={soft}>{b.ul.map((it, i) => <li key={i}>{renderInline(it, product)}</li>)}</ul>
  if (b.ol !== undefined)
    return <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed" style={soft}>{b.ol.map((it, i) => <li key={i}>{renderInline(it, product)}</li>)}</ol>
  if (b.code !== undefined)
    return (
      <pre className="mono mt-3 overflow-x-auto rounded-lg border p-3 text-[12px] leading-relaxed" style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface-sunken)', color: 'var(--admin-ink)' }}>
        <code>{b.code}</code>
      </pre>
    )
  if (b.table !== undefined)
    return (
      <div className="admin-card mt-4 overflow-x-auto p-0">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="mono text-[10px] uppercase tracking-[0.16em]" style={soft}>
              {b.table.head.map((h, i) => <th key={i} className="px-3 py-2.5 text-left font-medium">{renderInline(h, product)}</th>)}
            </tr>
          </thead>
          <tbody>
            {b.table.rows.map((row, r) => (
              <tr key={r} style={{ borderTop: '1px solid var(--admin-hairline)' }}>
                {row.map((cell, c) => <td key={c} className="px-3 py-2.5 align-top" style={soft}>{renderInline(cell, product)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  return null
}

export function KbBody({ doc, product }: { doc: KbDoc; product: string }) {
  return (
    <div>
      {doc.blocks.map((b, i) => (
        <Block key={i} b={b} product={product} />
      ))}
    </div>
  )
}

/** The anchored headings of a document, for the in-page table of contents. */
export function kbToc(doc: KbDoc): { id: string; title: string }[] {
  return doc.blocks.flatMap((b) => (b.h2 !== undefined && b.id !== undefined ? [{ id: b.id, title: b.h2 }] : []))
}
