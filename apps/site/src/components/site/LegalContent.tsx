import { Fragment, useSyncExternalStore, type ReactNode } from "react";

import i18n from "@/lib/i18n";
import { LegalPage } from "./LegalPage";
import type { DocBlock, LegalDoc, LocalizedDoc } from "@/content/legal/types";
import type { Lang } from "@/lib/i18n";

/**
 * Renders the structured legal/docs content model (content/legal/types.ts). Inline markup is a
 * deliberately tiny, safe subset — `**bold**`, `` `code` `` and `[text](href)` — so no HTML from
 * the content strings is ever injected (no dangerouslySetInnerHTML). Links render as plain anchors
 * to match the existing legal pages (a full navigation is fine for these low-frequency pages).
 */
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[(.+?)\]\(([^)]+)\)/g;

// Explicit element styling — the site has NO @tailwindcss/typography plugin, so `prose` classes are
// no-ops; every element is styled directly (matching the original hand-styled docs/legal pages).
function renderInline(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  let i = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={i} className="font-semibold text-ink">{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={i} className="mono rounded bg-ink/[0.06] px-1 py-0.5 text-[0.9em] text-ink">{m[2]}</code>);
    else if (m[3] !== undefined && m[4] !== undefined) {
      const external = /^https?:\/\//.test(m[4]);
      out.push(
        <a key={i} href={m[4]} className="text-[var(--brand-blue)] underline-offset-2 hover:underline" {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
          {m[3]}
        </a>,
      );
    }
    last = INLINE.lastIndex;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 1 ? out[0] : out.map((n, k) => <Fragment key={k}>{n}</Fragment>);
}

function Block({ b }: { b: DocBlock }) {
  // scroll-mt clears the sticky header when arriving via a #fragment from the app
  if (b.h2 !== undefined) return <h2 id={b.id} className="display mt-12 mb-3 scroll-mt-24 text-2xl font-semibold text-ink first:mt-2">{b.h2}</h2>;
  if (b.p !== undefined) return <p className="mt-4 leading-relaxed text-ink/80">{renderInline(b.p)}</p>;
  if (b.ul !== undefined) return <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-ink/80 marker:text-[var(--brand-blue)]">{b.ul.map((it, i) => <li key={i}>{renderInline(it)}</li>)}</ul>;
  if (b.ol !== undefined) return <ol className="mt-4 list-decimal space-y-2 pl-5 leading-relaxed text-ink/80 marker:text-muted-foreground">{b.ol.map((it, i) => <li key={i}>{renderInline(it)}</li>)}</ol>;
  if (b.code !== undefined) return <pre className="mt-4 overflow-x-auto rounded-lg border border-[var(--hairline)] bg-ink/[0.03] p-4 mono text-[12px] leading-relaxed text-ink/85"><code>{b.code}</code></pre>;
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

export function LegalContent({ doc, after }: { doc: LegalDoc; after?: ReactNode }) {
  return (
    <LegalPage label={doc.label} title={doc.title} updated={doc.updated}>
      {doc.notice !== undefined && (
        <p className="mb-2 rounded-lg border border-[var(--hairline)] bg-[rgba(10,20,40,0.4)] px-4 py-3 text-sm text-muted-foreground">
          {renderInline(doc.notice)}
        </p>
      )}
      {doc.blocks.map((b, i) => (
        <Block key={i} b={b} />
      ))}
      {after}
    </LegalPage>
  );
}

const LANGS: readonly Lang[] = ["en", "pl", "de", "lt"];

/**
 * The active language, subscribed DIRECTLY to the configured i18n instance's `languageChanged`
 * event via useSyncExternalStore. This is deliberately independent of react-i18next's
 * useTranslation: the marketing app applies the stored language in a post-mount effect, and that
 * changeLanguage does not reliably re-render every useTranslation consumer (the header updates,
 * long-form content lower in the tree did not — the "half-English" bug). Subscribing to the raw
 * event guarantees this page re-renders whenever the language actually changes.
 */
export function useActiveLang(): Lang {
  const lng = useSyncExternalStore(
    (cb) => {
      i18n.on("languageChanged", cb);
      return () => i18n.off("languageChanged", cb);
    },
    () => i18n.language,
    () => "en",
  );
  const base = (lng ?? "en").slice(0, 2) as Lang;
  return LANGS.includes(base) ? base : "en";
}

/** Picks the current language's document (EN fallback) and renders it. `after` renders extra
 *  content (e.g. an interactive widget) below the blocks. */
export function LocalizedLegalPage({ doc, after }: { doc: LocalizedDoc; after?: ReactNode }) {
  const lang = useActiveLang();
  return <LegalContent doc={doc[lang]} after={after} />;
}
