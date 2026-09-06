import { Link } from "@tanstack/react-router";
import { Info, Lightbulb, TriangleAlert } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { resolveLink, withProduct, type KbBlock, type KbCalloutTone, type KbDoc } from "@orbetra/kb";

/**
 * Renders a knowledge-base document on the PUBLIC site.
 *
 * Inline markup is the tiny safe subset the content model defines — `**bold**`, `` `code` `` and
 * `[text](href)` — parsed here rather than injected, so nothing from a content string ever reaches
 * dangerouslySetInnerHTML and a translator cannot introduce markup by accident.
 *
 * Link hrefs go through the package's own resolver: `kb:` becomes a route into /learn, `site:`
 * becomes an ordinary site link, and `app:` — a link into the dashboard — renders as plain emphasis
 * here, because a visitor reading the marketing site has no dashboard to be sent into.
 */
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[(.+?)\]\(([^)]+)\)/g;

/** The product name this surface substitutes into `{product}` — always ours, on our own site. */
const PRODUCT = "Orbetra";

function renderInline(text: string): ReactNode {
  const source = withProduct(text, PRODUCT);
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  let i = 0;
  while ((m = INLINE.exec(source)) !== null) {
    if (m.index > last) out.push(source.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<strong key={i} className="font-semibold text-ink">{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      out.push(<code key={i} className="mono rounded bg-ink/[0.06] px-1 py-0.5 text-[0.9em] text-ink">{m[2]}</code>);
    } else if (m[3] !== undefined && m[4] !== undefined) {
      out.push(<InlineLink key={i} href={m[4]} label={m[3]} />);
    }
    last = INLINE.lastIndex;
    i++;
  }
  if (last < source.length) out.push(source.slice(last));
  return out.length === 1 ? out[0] : out.map((n, k) => <Fragment key={k}>{n}</Fragment>);
}

const LINK_CLASS = "text-[var(--brand-blue)] underline-offset-2 hover:underline";

function InlineLink({ href, label }: { href: string; label: string }) {
  const target = resolveLink(href, "site");
  switch (target.kind) {
    case "article":
      return <Link to="/learn/$slug" params={{ slug: target.slug }} className={LINK_CLASS}>{label}</Link>;
    case "site":
      // a plain anchor, not a router Link: these paths are typed as strings in the content model,
      // and a long-lived tab whose bundle predates a route no-ops silently on a router Link
      return <a href={target.path} className={LINK_CLASS}>{label}</a>;
    case "external":
      return <a href={target.href} target="_blank" rel="noreferrer noopener" className={LINK_CLASS}>{label}</a>;
    default:
      // `app:` — a dashboard screen. Emphasised, not linked: there is nowhere to send a visitor.
      return <strong className="font-semibold text-ink">{label}</strong>;
  }
}

const CALLOUT: Record<KbCalloutTone, { icon: typeof Info; ring: string; tint: string }> = {
  note: { icon: Info, ring: "rgba(37,99,235,0.35)", tint: "rgba(37,99,235,0.07)" },
  tip: { icon: Lightbulb, ring: "rgba(16,185,129,0.35)", tint: "rgba(16,185,129,0.07)" },
  warning: { icon: TriangleAlert, ring: "rgba(245,158,11,0.40)", tint: "rgba(245,158,11,0.08)" },
};

function Block({ b }: { b: KbBlock }) {
  // scroll-mt clears the sticky header when arriving via a #fragment from a table of contents
  if (b.h2 !== undefined)
    return <h2 id={b.id} className="display mt-12 mb-3 scroll-mt-24 text-2xl font-semibold text-ink first:mt-0">{b.h2}</h2>;
  if (b.callout !== undefined) {
    const { icon: Icon, ring, tint } = CALLOUT[b.callout];
    return (
      <div className="mt-5 flex gap-3 rounded-xl border px-4 py-3.5" style={{ borderColor: ring, background: tint }}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink/70" aria-hidden />
        <p className="text-sm leading-relaxed text-ink/85">{renderInline(b.p ?? "")}</p>
      </div>
    );
  }
  if (b.p !== undefined) return <p className="mt-4 leading-relaxed text-ink/80">{renderInline(b.p)}</p>;
  if (b.ul !== undefined)
    return <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-ink/80 marker:text-[var(--brand-blue)]">{b.ul.map((it, i) => <li key={i}>{renderInline(it)}</li>)}</ul>;
  if (b.ol !== undefined)
    return <ol className="mt-4 list-decimal space-y-2 pl-5 leading-relaxed text-ink/80 marker:text-muted-foreground">{b.ol.map((it, i) => <li key={i}>{renderInline(it)}</li>)}</ol>;
  if (b.code !== undefined)
    return <pre className="mt-4 overflow-x-auto rounded-lg border border-[var(--hairline)] bg-ink/[0.03] p-4 mono text-[12px] leading-relaxed text-ink/85"><code>{b.code}</code></pre>;
  if (b.table !== undefined)
    return (
      <div className="mt-6 surface-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {b.table.head.map((h, i) => <th key={i} className="px-4 py-3 text-left font-medium">{renderInline(h)}</th>)}
            </tr>
          </thead>
          <tbody>
            {b.table.rows.map((row, r) => (
              <tr key={r} className="border-t border-[var(--hairline)]">
                {row.map((cell, c) => <td key={c} className="px-4 py-3 align-top text-ink/80">{renderInline(cell)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return null;
}

export function KbContent({ doc }: { doc: KbDoc }) {
  return (
    <div>
      {doc.blocks.map((b, i) => (
        <Block key={i} b={b} />
      ))}
    </div>
  );
}

/** The headings of a document, for a table of contents. Only headings that carry an anchor. */
export function tocOf(doc: KbDoc): { id: string; title: string }[] {
  return doc.blocks.flatMap((b) => (b.h2 !== undefined && b.id !== undefined ? [{ id: b.id, title: b.h2 }] : []));
}
