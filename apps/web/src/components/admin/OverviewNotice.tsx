import { useTranslation } from 'react-i18next'

import { useAccountContext } from '@/lib/accountContext'

/**
 * Why the buttons are gone.
 *
 * An overseer in the all-accounts overview gets no create/edit affordances (TSP UX audit
 * 2026-09-03) — but silently missing buttons read as a bug, not a rule. One quiet line names the
 * rule and points at the switcher. Renders nothing for everyone else.
 */
export function OverviewNotice() {
  const { t } = useTranslation()
  const { overseer, ctx } = useAccountContext()
  if (!overseer || ctx !== '') return null
  return (
    <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }} data-testid="overview-notice">
      {t('shell.overviewNotice')}
    </p>
  )
}
