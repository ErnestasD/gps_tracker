import { Link } from "@tanstack/react-router";
import { HelpCircle } from "lucide-react";

import { isVisible, metaBySlug, type KbSlug } from "@orbetra/kb";

import { useActiveLang } from "@/components/site/LegalContent";
import { cn } from "@/lib/utils";

/**
 * A "learn more" link into the knowledge base, for the marketing pages and the mock-admin demo.
 *
 * Metadata only — the article's title for the label and the audience gate for whether to render at
 * all. Importing the bodies here would put the whole knowledge base into the page that links to it.
 *
 * The demo uses this too: the real dashboard carries a `?` beside the same controls, and a demo
 * that quietly dropped them would be showing a product we do not ship.
 */
export function LearnLink({
  slug,
  label,
  className,
  iconOnly = false,
}: {
  slug: KbSlug;
  /** overrides the article's own title */
  label?: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const lang = useActiveLang();
  const meta = metaBySlug(slug);
  if (meta === undefined || !isVisible(meta, { surface: "site" })) return null;
  const title = label ?? meta.title[lang];
  return (
    <Link
      to="/learn/$slug"
      params={{ slug }}
      aria-label={iconOnly ? title : undefined}
      title={iconOnly ? title : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-ink",
        className,
      )}
    >
      <HelpCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {!iconOnly && <span>{title}</span>}
    </Link>
  );
}
