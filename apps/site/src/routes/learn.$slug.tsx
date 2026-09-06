import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import { KbContent, tocOf } from "@/components/site/KbContent";
import { SITE_GROUPS, categoryMeta, findArticle, neighbours, related, useKbLang } from "@/lib/kb";

/**
 * One knowledge-base article.
 *
 * The metadata is resolved in `loader` so the page's title and description are the ARTICLE's, in
 * the reader's language — a search engine, a chat preview and a shared link all read that, and a
 * generic "Knowledge base" on fifty pages is fifty pages that look identical from outside.
 */
export const Route = createFileRoute("/learn/$slug")({
  loader: ({ params }) => {
    const article = findArticle(params.slug);
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router notFound idiom
    if (article === undefined) throw notFound();
    return { article };
  },
  head: ({ loaderData }) => {
    // EN for the head: it is resolved once, at navigation, before i18n has necessarily settled, and
    // a stale title is worse than an English one. The BODY is fully localised.
    const doc = loaderData?.article.doc.en;
    if (doc === undefined) return {};
    return {
      meta: [
        { title: `${doc.title} — Orbetra` },
        { name: "description", content: doc.summary },
        { property: "og:title", content: doc.title },
        { property: "og:description", content: doc.summary },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  notFoundComponent: ArticleNotFound,
  component: ArticlePage,
});

function ArticlePage() {
  const { article } = Route.useLoaderData();
  const { t } = useTranslation();
  const lang = useKbLang();
  const doc = article.doc[lang];
  const toc = tocOf(doc);
  const { prev, next } = neighbours(article.slug);
  const siblings = related(article);
  const category = categoryMeta(article.category);

  return (
    <div className="mx-auto max-w-7xl px-6 pt-20 md:pt-28 pb-24">
      <div className="grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_14rem]">
        {/* the whole knowledge base, always in reach — a reader who took a wrong turn should not
            have to go back to an index to take the right one */}
        <nav aria-label={t("learn.browse")} className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
            <Link to="/learn" className="mono mb-4 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-ink">
              <ArrowLeft className="h-3 w-3" aria-hidden /> {t("learn.backToIndex")}
            </Link>
            {SITE_GROUPS.map(({ category: id, articles }) => (
              <div key={id} className="mb-5">
                <div className="mono mb-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {categoryMeta(id).label[lang].title}
                </div>
                <ul className="space-y-0.5 border-l border-[var(--hairline)]">
                  {articles.map((a) => {
                    const active = a.slug === article.slug;
                    return (
                      <li key={a.slug}>
                        <Link
                          to="/learn/$slug"
                          params={{ slug: a.slug }}
                          aria-current={active ? "page" : undefined}
                          className={
                            active
                              ? "-ml-px block border-l-2 border-[var(--brand-blue)] py-1 pl-3 text-sm font-medium text-ink"
                              : "-ml-px block border-l-2 border-transparent py-1 pl-3 text-sm text-muted-foreground transition-colors hover:border-[var(--hairline)] hover:text-ink"
                          }
                        >
                          {a.doc[lang].title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <article className="min-w-0 max-w-3xl">
          <div className="section-label">
            <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />— {category.label[lang].title}
          </div>
          <h1 className="display mt-4 text-3xl font-bold text-ink md:text-4xl">{doc.title}</h1>
          <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{doc.summary}</p>

          {/* mobile/tablet table of contents — the sticky rail is desktop-only */}
          {toc.length > 1 && (
            <nav aria-label={t("learn.onThisPage")} className="mt-8 rounded-xl border border-[var(--hairline)] bg-[var(--blueprint)]/40 px-4 py-3 xl:hidden">
              <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t("learn.onThisPage")}</div>
              <ul className="mt-2 space-y-1">
                {toc.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="text-sm text-muted-foreground transition-colors hover:text-ink">{h.title}</a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="mt-8">
            <KbContent doc={doc} />
          </div>

          {(prev !== undefined || next !== undefined) && (
            <nav className="mt-14 grid gap-3 border-t border-[var(--hairline)] pt-6 sm:grid-cols-2">
              {prev !== undefined ? (
                <Link to="/learn/$slug" params={{ slug: prev.slug }} className="surface-card surface-card-hover px-4 py-3">
                  <span className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    <ArrowLeft className="h-3 w-3" aria-hidden /> {t("learn.prev")}
                  </span>
                  <span className="mt-1 block font-medium text-ink">{prev.doc[lang].title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next !== undefined && (
                <Link to="/learn/$slug" params={{ slug: next.slug }} className="surface-card surface-card-hover px-4 py-3 sm:text-right">
                  <span className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:justify-end">
                    {t("learn.next")} <ArrowRight className="h-3 w-3" aria-hidden />
                  </span>
                  <span className="mt-1 block font-medium text-ink">{next.doc[lang].title}</span>
                </Link>
              )}
            </nav>
          )}

          {siblings.length > 0 && (
            <section className="mt-12">
              <div className="mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t("learn.inThisSection")}</div>
              <ul className="mt-3 space-y-1.5">
                {siblings.map((a) => (
                  <li key={a.slug}>
                    <Link to="/learn/$slug" params={{ slug: a.slug }} className="text-sm text-[var(--brand-blue)] underline-offset-2 hover:underline">
                      {a.doc[lang].title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>

        {toc.length > 1 && (
          <nav aria-label={t("learn.onThisPage")} className="hidden xl:block">
            <div className="sticky top-24">
              <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t("learn.onThisPage")}</div>
              <ul className="mt-3 space-y-1.5 border-l border-[var(--hairline)]">
                {toc.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="-ml-px block border-l-2 border-transparent pl-3 text-sm text-muted-foreground transition-colors hover:border-[var(--hairline)] hover:text-ink">
                      {h.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}

function ArticleNotFound() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl px-6 pt-28 pb-24 text-center">
      <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
      <h1 className="display mt-4 text-3xl font-bold text-ink">{t("learn.notFound")}</h1>
      <p className="mt-3 text-muted-foreground">{t("learn.notFoundBody")}</p>
      <Link to="/learn" className="pill-primary hover:pill-primary-hover mt-8 inline-flex items-center gap-2">
        {t("learn.backToIndex")} <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}
