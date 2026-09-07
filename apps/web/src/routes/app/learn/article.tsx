import { Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, BookOpen } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { KB_CATEGORIES, articleBySlug, visibleArticles } from '@orbetra/kb'
import { KB_ARTICLES } from '@orbetra/kb/content'

import { AdminButton, EmptyState } from '@/components/admin/AdminKit'
import { KbBody, kbToc } from '@/components/kb/KbBody'
import { useKb } from '@/components/kb/useKb'
import { kbPath } from '@/lib/kb'

/**
 * One help article, inside the dashboard.
 *
 * An article the reader may not see is a 404 here, not a redacted page: the gate is the same
 * `visibleArticles` the index uses, so a typed URL cannot reach an article about a plan this tenant
 * is not on or a screen this role cannot open.
 */
export function LearnArticlePage({ slug }: { slug: string }) {
  const { t } = useTranslation()
  const { lang, viewer, product } = useKb()
  const articles = useMemo(() => visibleArticles(KB_ARTICLES, viewer), [viewer])
  const article = articleBySlug(articles, slug)

  /**
   * Land on the heading the link asked for.
   *
   * A contextual `?` opens `/app/learn/<slug>#<anchor>` in a NEW TAB, so this is a cold document
   * load — and by the time it happens the browser has long given up on the fragment: the `/app`
   * guard awaits a session refresh and a map-token fetch, and this page is the tree's only lazily
   * imported route, so the heading does not exist in the DOM until well after the load event.
   * Neither the browser's native fragment scroll nor the router's own hash handling can bridge
   * that; both fire while the article is still a promise.
   *
   * Keyed on the slug so following a `kb:` link inside an article scrolls to the top of the new
   * one rather than holding the previous article's fragment.
   */
  useEffect(() => {
    const anchor = window.location.hash.slice(1)
    if (anchor === '') return
    // one frame after paint — the blocks render synchronously once the chunk is in
    const raf = requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView())
    return () => cancelAnimationFrame(raf)
  }, [slug, article])

  if (article === undefined) {
    return (
      <div className="w-full p-4 md:p-6">
        <EmptyState
          icon={<BookOpen className="h-5 w-5" />}
          title={t('learn.notFound')}
          description={t('learn.notFoundBody')}
          action={
            <Link to="/app/learn">
              <AdminButton variant="secondary" data-testid="learn-back">{t('learn.backToIndex')}</AdminButton>
            </Link>
          }
        />
      </div>
    )
  }

  const doc = article.doc[lang]
  const toc = kbToc(doc)
  const i = articles.findIndex((a) => a.slug === article.slug)
  const prev = articles[i - 1]
  const next = articles[i + 1]
  const category = KB_CATEGORIES.find((c) => c.id === article.category)
  const siblings = articles.filter((a) => a.category === article.category && a.slug !== article.slug)

  return (
    <div className="w-full p-4 md:p-6">
      <div className="mx-auto grid max-w-6xl gap-8 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <article className="min-w-0 max-w-3xl">
          <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
            <Link to="/app/learn" className="inline-flex items-center gap-1 hover:opacity-80" data-testid="learn-breadcrumb">
              <ArrowLeft className="h-3 w-3" aria-hidden />
              {t('learn.backToIndex')}
            </Link>
            {category !== undefined && (
              <>
                <span className="opacity-50">›</span>
                <span>{category.label[lang].title}</span>
              </>
            )}
          </nav>

          <h1 className="display text-2xl font-semibold" style={{ color: 'var(--admin-ink)' }} data-testid="learn-title">
            {doc.title}
          </h1>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--admin-ink-soft)' }}>{doc.summary}</p>

          {/* narrow-screen table of contents — the rail is xl-only */}
          {toc.length > 1 && (
            <nav aria-label={t('learn.onThisPage')} className="mt-5 rounded-md border px-3 py-2.5 xl:hidden" style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface-sunken)' }}>
              <div className="mono text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--admin-ink-soft)' }}>{t('learn.onThisPage')}</div>
              <ul className="mt-1.5 space-y-1">
                {toc.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="text-sm hover:opacity-80" style={{ color: 'var(--admin-ink-soft)' }}>{h.title}</a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="mt-6">
            <KbBody doc={doc} product={product} />
          </div>

          {(prev !== undefined || next !== undefined) && (
            <nav className="mt-10 grid gap-2 pt-5 sm:grid-cols-2" style={{ borderTop: '1px solid var(--admin-hairline)' }}>
              {prev !== undefined ? (
                <Link to={kbPath(prev.slug)} className="admin-card p-3 transition-colors hover:border-[var(--admin-brand)]">
                  <span className="mono flex items-center gap-1 text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--admin-ink-soft)' }}>
                    <ArrowLeft className="h-3 w-3" aria-hidden /> {t('learn.prev')}
                  </span>
                  <span className="mt-1 block text-sm font-medium" style={{ color: 'var(--admin-ink)' }}>{prev.doc[lang].title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next !== undefined && (
                <Link to={kbPath(next.slug)} className="admin-card p-3 transition-colors hover:border-[var(--admin-brand)] sm:text-right">
                  <span className="mono flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] sm:justify-end" style={{ color: 'var(--admin-ink-soft)' }}>
                    {t('learn.next')} <ArrowRight className="h-3 w-3" aria-hidden />
                  </span>
                  <span className="mt-1 block text-sm font-medium" style={{ color: 'var(--admin-ink)' }}>{next.doc[lang].title}</span>
                </Link>
              )}
            </nav>
          )}

          {siblings.length > 0 && (
            <section className="mt-8">
              <div className="mono text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--admin-ink-soft)' }}>{t('learn.inThisSection')}</div>
              <ul className="mt-2 space-y-1">
                {siblings.map((a) => (
                  <li key={a.slug}>
                    <Link to={kbPath(a.slug)} className="text-sm underline-offset-2 hover:underline" style={{ color: 'var(--admin-brand)' }}>
                      {a.doc[lang].title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>

        {toc.length > 1 && (
          <nav aria-label={t('learn.onThisPage')} className="hidden xl:block">
            <div className="sticky top-6">
              <div className="mono text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--admin-ink-soft)' }}>{t('learn.onThisPage')}</div>
              <ul className="mt-2 space-y-1" style={{ borderLeft: '1px solid var(--admin-hairline)' }}>
                {toc.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="-ml-px block border-l-2 border-transparent pl-3 text-sm hover:opacity-80" style={{ color: 'var(--admin-ink-soft)' }}>
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
  )
}
