import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { AdminButton } from '@/components/admin/AdminKit'
import { getCurrentUser } from '@/lib/auth'
import { getReadiness, mayReadReadiness } from '@/lib/branding'

/**
 * "Your workspace is not live yet" — the card that makes the readiness gate legible.
 *
 * Without it the gate is a silent 403 on the Create-customer button, which is a worse product than
 * no gate at all: the operator sees a refusal and has to guess. The server owns the decision; this
 * only renders it, reading the same value the 403 is computed from so the two cannot disagree.
 *
 * ── Who may read this ────────────────────────────────────────────────────────────────────────────
 * ONLY a tenant-wide administrator — the reseller themselves. The check is inside the component and
 * not merely at the call site, because it first shipped on the operator dashboard, which is the page
 * the reseller's OWN CUSTOMERS see. Every line here is written in the second person to the reseller,
 * and one of them — "on ours, your customers see our hostname" — tells the reader there is a third
 * party behind the product they are using. That is precisely the leak this whole feature exists to
 * close, arriving through the feature itself. A call-site condition would have been just as correct
 * and just as easy to lose on the next refactor; this one travels with the component.
 *
 * Renders NOTHING for a tenant that is ready and fully configured — the common case, where a
 * permanent setup banner would be pure noise.
 */
export function ReadinessCard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const mayRead = mayReadReadiness(getCurrentUser())
  const r = useQuery({ queryKey: ['readiness'], queryFn: getReadiness, staleTime: 60_000, enabled: mayRead })
  const data = r.data
  if (!mayRead || data === undefined || data.mode === 'not_white_label') return null
  if (data.ready && data.softHints.length === 0) return null

  const blocking = !data.ready
  return (
    <section
      className="admin-card p-4"
      data-testid="dash-readiness"
      style={blocking ? { borderColor: 'var(--admin-danger)' } : {}}
      role={blocking ? 'alert' : undefined}
    >
      <h2 className="text-sm font-semibold" style={{ color: blocking ? 'var(--admin-danger)' : 'var(--admin-ink)' }}>
        {t(blocking ? 'readiness.blockedTitle' : 'readiness.hintsTitle')}
      </h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>
        {t(blocking ? 'readiness.blockedDesc' : 'readiness.hintsDesc')}
      </p>
      <ul className="mt-3 space-y-1 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>
        {data.hardBlockers.map((b) => (
          <li key={b} data-testid={`readiness-blocker-${b}`}>· {t(`readiness.blocker.${b}`)}</li>
        ))}
        {data.softHints.map((h) => (
          <li key={h} data-testid={`readiness-hint-${h}`}>· {t(`readiness.hint.${h}`)}</li>
        ))}
      </ul>
      <div className="mt-3">
        <AdminButton variant={blocking ? 'primary' : 'secondary'} onClick={() => void navigate({ to: '/app/branding' })} data-testid="readiness-cta">
          {t('readiness.cta')}
        </AdminButton>
      </div>
    </section>
  )
}
