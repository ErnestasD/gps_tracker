import { Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAccountContext } from '@/lib/accountContext'

/**
 * Why the buttons are gone.
 *
 * An overseer in the all-accounts overview gets no create/edit affordances (TSP UX audit
 * 2026-09-03) — but silently missing buttons read as a bug, not a rule. One line names the rule and
 * points at the switcher. Renders nothing for everyone else.
 *
 * It was a bare grey 12px line and the founder still filed the missing geofence buttons as a defect
 * (2026-09-04). A notice that does not get read is not a notice, so it now carries the weight of
 * one: an icon, a rule, and a tinted strip that reads as a STATE of the page rather than a caption
 * under the title. Still one line, still silent for everybody it does not apply to.
 */
export function OverviewNotice() {
  const { t } = useTranslation()
  const { overseer, ctx } = useAccountContext()
  if (!overseer || ctx !== '') return null
  return (
    <p
      className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
      style={{
        color: 'var(--admin-ink)',
        borderColor: 'var(--admin-brand-soft)',
        background: 'var(--admin-brand-soft)',
      }}
      data-testid="overview-notice"
    >
      <Eye className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--admin-brand)' }} aria-hidden />
      {t('shell.overviewNotice')}
    </p>
  )
}
