import { createFileRoute, Link } from "@tanstack/react-router";
import * as Icons from "lucide-react";
import { ArrowRight, Search, X, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { KB } from "@orbetra/kb";

import { SITE_GROUPS, categoryMeta, findArticle, search, useKbLang } from "@/lib/kb";

/**
 * The knowledge-base index — every article, grouped by the shelf it sits on.
 *
 * Deliberately a single page rather than a category-per-page hierarchy: fifty articles fit on one
 * scroll, and a reader who does not yet know our vocabulary cannot pick the right category anyway.
 * Search filters the same list in place, so there is never a "no results" page to back out of.
 */
export const Route = createFileRoute("/learn/")({
  head: () => ({
    meta: [
      { title: "Knowledge base — Orbetra" },
      {
        name: "description",
        content:
          "Plain-language guides to GPS fleet tracking: trackers and SIM cards, the live map, trips, geofences and alerts, reports, billing, white-label and the API.",
      },
      { property: "og:title", content: "Knowledge base — Orbetra" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: LearnIndexPage,
});

/**
 * The four articles a new reader should meet first — one per stage of a first day, rather than four
 * from the same shelf. The categories below repeat two of them, which is the price of an index that
 * is also complete; picking them from four different shelves keeps the repetition to a minimum.
 */
const START_HERE = [KB.howTrackingWorks, KB.firstSteps, KB.connectATracker, KB.deviceNotReporting];

function LearnIndexPage() {
  const { t } = useTranslation();
  const lang = useKbLang();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const results = useMemo(() => (trimmed === "" ? null : search(lang, trimmed)), [lang, trimmed]);
  const starters = START_HERE.map((s) => findArticle(s)).filter((a): a is NonNullable<typeof a> => a !== undefined);

  return (
    <div className="mx-auto max-w-6xl px-6 pt-20 md:pt-28 pb-24">
      <header className="max-w-3xl">
        <div className="section-label">
          <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />— {t("learn.label")}
        </div>
        <h1 className="display mt-4 text-4xl font-bold text-ink md:text-5xl">
          {t("learn.title1")} <span className="text-gradient">{t("learn.title2")}</span>
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("learn.sub")}</p>
      </header>

      <div className="mt-8 max-w-2xl">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("learn.searchPlaceholder")}
            aria-label={t("learn.searchAria")}
            className="w-full rounded-xl border border-[var(--hairline)] bg-[var(--blueprint)]/40 py-3 pl-11 pr-11 text-sm text-ink outline-none transition-colors placeholder:text-muted-foreground focus:border-[var(--brand-blue)]"
          />
          {trimmed !== "" && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("learn.clear")}
              className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {results !== null ? (
        <section className="mt-10" aria-live="polite">
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {t("learn.results", { count: results.length })}
          </div>
          {results.length === 0 ? (
            <p className="mt-4 text-muted-foreground">{t("learn.noResults")}</p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {results.map((a) => (
                <ArticleCard key={a.slug} slug={a.slug} title={a.doc[lang].title} summary={a.doc[lang].summary} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="mt-12">
            <div className="mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t("learn.startHere")}</div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {starters.map((a) => (
                <ArticleCard key={a.slug} slug={a.slug} title={a.doc[lang].title} summary={a.doc[lang].summary} />
              ))}
            </div>
          </section>

          <section className="mt-16">
            <div className="mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t("learn.browse")}</div>
            <div className="mt-6 space-y-12">
              {SITE_GROUPS.map(({ category, articles }) => {
                const meta = categoryMeta(category);
                const Icon = (Icons as unknown as Record<string, LucideIcon>)[meta.icon] ?? Icons.BookOpen;
                return (
                  <div key={category}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--hairline)] bg-[rgba(37,99,235,0.08)]">
                        <Icon className="h-4 w-4 text-[var(--brand-blue)]" strokeWidth={1.6} aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <h2 className="display text-xl font-semibold text-ink">{meta.label[lang].title}</h2>
                        <p className="text-sm text-muted-foreground">{meta.label[lang].blurb}</p>
                      </div>
                      <span className="mono ml-auto hidden shrink-0 pt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
                        {t("learn.articles", { count: articles.length })}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {articles.map((a) => (
                        <ArticleCard key={a.slug} slug={a.slug} title={a.doc[lang].title} summary={a.doc[lang].summary} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      <section className="mt-20 surface-card px-6 py-8 text-center">
        <h2 className="display text-2xl font-semibold text-ink">{t("learn.ctaTitle")}</h2>
        <p className="mx-auto mt-2 max-w-xl text-muted-foreground">{t("learn.ctaBody")}</p>
        <Link to="/pilot" className="pill-primary hover:pill-primary-hover mt-6 inline-flex items-center gap-2">
          {t("learn.ctaButton")} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>
    </div>
  );
}

function ArticleCard({ slug, title, summary }: { slug: string; title: string; summary: string }) {
  return (
    <Link
      to="/learn/$slug"
      params={{ slug }}
      className="surface-card surface-card-hover group flex flex-col gap-1.5 px-4 py-4 transition-colors"
    >
      <span className="display flex items-center gap-1.5 font-semibold text-ink">
        {title}
        <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" aria-hidden />
      </span>
      <span className="text-sm leading-relaxed text-muted-foreground">{summary}</span>
    </Link>
  );
}
