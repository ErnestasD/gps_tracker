import type { ReactNode } from "react";

export function LegalPage({
  label,
  title,
  updated,
  children,
}: {
  label: string;
  title: string;
  updated: string;
  children?: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-6 pt-20 md:pt-28 pb-24">
      <div className="section-label">
        <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
        — {label}
      </div>
      <h1 className="display text-4xl md:text-5xl font-bold mt-4 text-ink">{title}</h1>
      <p className="mono text-xs tracking-widest text-muted-foreground mt-2">LAST UPDATED · {updated}</p>
      <div className="mt-10 prose prose-slate max-w-none prose-headings:font-display prose-headings:text-ink prose-p:text-ink/80 prose-a:text-[var(--brand-blue)]">
        {children ?? (
          <p className="text-muted-foreground">
            Placeholder legal content — TODO-LEGAL. Replace with the finalized text before launch.
          </p>
        )}
      </div>
    </article>
  );
}
