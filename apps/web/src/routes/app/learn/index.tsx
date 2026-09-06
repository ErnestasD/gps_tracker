import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KB, articlesByCategory, KB_CATEGORIES, searchArticles, visibleArticles, type KbCategoryId } from '@orbetra/kb'
import { KB_ARTICLES } from '@orbetra/kb/content'

import { PageHeader } from '@/components/admin/AdminKit'
import { useKbGate } from '@/components/kb/useKb'
import { kbPath } from '@/lib/kb'

/**
 * The in-product help index.
 *
 * The SAME articles the public site publishes, rendered inside the dashboard under whatever brand
 * this deployment wears. That is the point: a reseller's customer gets the full manual without ever
 * leaving their supplier's product, and without a link to a website that would tell them who really
 * built it. Articles their plan, role or host puts out of scope are filtered out entirely rather
 * than shown and refused.
 *
 * This module — and only this module and its sibling — imports `@orbetra/kb/content`, so the whole
 * knowledge base is a lazy chunk that an operator who never opens the help never downloads.
 */
export function LearnIndexPage() {
  const { t } = useTranslation()
  const { lang, viewer } = useKbGate()
  const [query, setQuery] = useState('')
  const trimmed = query.trim()

  const articles = useMemo(() => visibleArticles(KB_ARTICLES, viewer), [viewer])
  const groups = useMemo(() => articlesByCategory(articles), [articles])
  const results = useMemo(() => (trimmed === '' ? null : searchArticles(articles, lang, trimmed)), [articles, lang, trimmed])
  const starters = [KB.howTrackingWorks, KB.firstSteps, KB.glossary, KB.deviceNotReporting]
    .map((s) => articles.find((a) => a.slug === s))
    .filter((a): a is NonNullable<typeof a> => a !== undefined)

  return (
    <div className="w-full space-y-4 p-4 md:p-6">
      <PageHeader title={t('learn.title')} description={t('learn.desc')} className="mb-0" />

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--admin-ink-soft)' }} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('learn.searchPlaceholder')}
          aria-label={t('learn.searchAria')}
          data-testid="learn-search"
          className="h-10 w-full rounded-md border pl-9 pr-9 text-sm outline-none transition-colors focus:ring-2 focus:ring-[var(--admin-brand)]/30"
          style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }}
        />
        {trimmed !== '' && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={t('learn.clear')}
            className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded"
            style={{ color: 'var(--admin-ink-soft)' }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {results !== null ? (
        <section aria-live="polite" data-testid="learn-results">
          <SectionLabel>{t('learn.results', { count: results.length })}</SectionLabel>
          {results.length === 0 ? (
            <p className="mt-2 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('learn.noResults')}</p>
          ) : (
            <CardGrid prefix="learn-result" items={results.map((a) => ({ slug: a.slug, title: a.doc[lang].title, summary: a.doc[lang].summary }))} />
          )}
        </section>
      ) : (
        <>
          <section>
            <SectionLabel>{t('learn.startHere')}</SectionLabel>
            <CardGrid prefix="learn-start" items={starters.map((a) => ({ slug: a.slug, title: a.doc[lang].title, summary: a.doc[lang].summary }))} />
          </section>

          {groups.map(({ category, articles: inCategory }) => (
            <section key={category}>
              <CategoryHeading id={category} lang={lang} />
              <CardGrid prefix="learn-card" items={inCategory.map((a) => ({ slug: a.slug, title: a.doc[lang].title, summary: a.doc[lang].summary }))} />
            </section>
          ))}
        </>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mono mb-2 mt-4 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--admin-ink-soft)' }}>
      {children}
    </div>
  )
}

function CategoryHeading({ id, lang }: { id: KbCategoryId; lang: 'en' | 'lt' | 'pl' | 'de' }) {
  const meta = KB_CATEGORIES.find((c) => c.id === id)
  if (meta === undefined) return null
  return (
    <div className="mb-2 mt-6 flex items-baseline gap-2">
      <BookOpen className="h-4 w-4 shrink-0 translate-y-0.5" style={{ color: 'var(--admin-brand)' }} aria-hidden />
      <h2 className="display text-base font-semibold" style={{ color: 'var(--admin-ink)' }}>{meta.label[lang].title}</h2>
      <span className="hidden text-xs sm:inline" style={{ color: 'var(--admin-ink-soft)' }}>{meta.label[lang].blurb}</span>
    </div>
  )
}

/**
 * `prefix` exists because an article can legitimately appear twice on this page — once under
 * "Start here" and again on its own shelf. One test id for both is ambiguous to anything that has
 * to point at a specific card, so each section names its own.
 */
function CardGrid({ items, prefix }: { items: { slug: string; title: string; summary: string }[]; prefix: string }) {
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {items.map((it) => (
        <Link
          key={it.slug}
          to={kbPath(it.slug)}
          data-testid={`${prefix}-${it.slug}`}
          className="admin-card group flex flex-col gap-1 p-3 transition-colors hover:border-[var(--admin-brand)]"
        >
          <span className="display flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
            {it.title}
            <ArrowRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden />
          </span>
          <span className="text-xs leading-relaxed" style={{ color: 'var(--admin-ink-soft)' }}>{it.summary}</span>
        </Link>
      ))}
    </div>
  )
}
