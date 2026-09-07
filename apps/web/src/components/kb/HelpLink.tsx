import { HelpCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { isVisible, metaBySlug, type KbSlug } from '@orbetra/kb'

import { kbPath } from '@/lib/kb'
import { cn } from '@/lib/utils'

import { useKbGate } from './useKb'

/**
 * The contextual "learn more" affordance: a small ? beside a control, opening the article that
 * explains it in a NEW TAB.
 *
 * A new tab rather than a navigation, deliberately. These sit next to half-filled forms, drawn
 * geofences and open sheets; sending the reader away to read three paragraphs and back would throw
 * away whatever they were in the middle of. The help opens beside their work instead.
 *
 * It renders NOTHING when the article is not reachable for this reader — a plan without the
 * feature, a role without the screen, a white-label host where the article is withheld. A help icon
 * leading somewhere the reader may not go is worse than no icon at all.
 *
 * The slug is typed (`KB.geofences`), never a bare string: a typo in a string compiles and 404s.
 * Only the article's METADATA is consulted here, from the package root, so a page carrying six of
 * these downloads no article prose at all — see packages/kb's two entry points.
 */
export function HelpLink({
  slug,
  anchor,
  label,
  className,
  testId,
}: {
  slug: KbSlug
  /** a heading id inside the article, to land on the paragraph that answers the question */
  anchor?: string
  /** shown beside the icon; omitted, the icon stands alone with an accessible name */
  label?: string
  className?: string
  testId?: string
}) {
  const { t } = useTranslation()
  const { viewer, lang } = useKbGate()
  const meta = metaBySlug(slug)
  if (meta === undefined || !isVisible(meta, viewer)) return null
  const title = meta.title[lang]
  const href = anchor === undefined ? kbPath(slug) : `${kbPath(slug)}#${anchor}`
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={t('learn.openHelp', { title })}
      aria-label={t('learn.openHelp', { title })}
      data-testid={testId ?? `help-${slug}`}
      // several of these sit inside a <label> that wraps its own control. A click there is
      // forwarded to the control by the browser, so opening the help would also drop a select
      // open behind the new tab. Stopping the event at the anchor is what keeps the two apart.
      onClick={(e) => e.stopPropagation()}
      className={cn('inline-flex shrink-0 items-center gap-1 rounded text-xs transition-opacity hover:opacity-70', className)}
      style={{ color: 'var(--admin-ink-soft)' }}
    >
      <HelpCircle className="h-3.5 w-3.5" aria-hidden />
      {label !== undefined && <span>{label}</span>}
    </a>
  )
}

/**
 * The same destination as a full-width row, for the bottom of a page or an empty state: an icon, a
 * title and a one-line reason to click. Used where a bare `?` would be too quiet to find.
 */
export function HelpCard({ slug, className, testId }: { slug: KbSlug; className?: string; testId?: string }) {
  const { t } = useTranslation()
  const { viewer, lang } = useKbGate()
  const meta = metaBySlug(slug)
  if (meta === undefined || !isVisible(meta, viewer)) return null
  return (
    <a
      href={kbPath(slug)}
      target="_blank"
      rel="noreferrer"
      data-testid={testId ?? `help-card-${slug}`}
      className={cn('inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-opacity hover:opacity-80', className)}
      style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface-sunken)', color: 'var(--admin-ink-soft)' }}
    >
      <HelpCircle className="h-4 w-4 shrink-0" aria-hidden />
      <span>{t('learn.readAbout', { title: meta.title[lang] })}</span>
    </a>
  )
}
