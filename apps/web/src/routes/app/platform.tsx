import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { PageHeader } from '@/components/admin/AdminKit'
import { getCurrentUser } from '@/lib/auth'
import { listTenants } from '@/lib/devices'
import { monthStartUtc, platformUsage } from '@/lib/usage'

const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)' }

/**
 * Platform admin panel (E07-4, W7 S4): tenants + usage (billable device-days this UTC month).
 * platform_admin only — the in-page gate mirrors quarantine; the server 403s everyone else.
 * Re-skinned onto the admin design (ADR-028): PageHeader + admin-card table, emphasized total.
 */
export function PlatformPage() {
  const { t } = useTranslation()
  const isPlatform = getCurrentUser()?.role === 'platform_admin'
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: listTenants, enabled: isPlatform })
  const usage = useQuery({ queryKey: ['platform-usage'], queryFn: () => platformUsage(monthStartUtc()), enabled: isPlatform })

  if (!isPlatform) {
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="platform-denied">
        {t('platform.denied')}
      </div>
    )
  }

  const usageByTenant = new Map((usage.data ?? []).map((u) => [u.tenantId, u]))
  const totalDays = (usage.data ?? []).reduce((s, u) => s + u.deviceDays, 0)
  // a failed usage fetch used to render as an authoritative "0 device-days" for every tenant —
  // show '—' + a banner instead so nobody reads billing usage as genuinely zero
  const usageErr = usage.isError

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('platform.title')} description={t('platform.desc')} />

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('platform.tenants')}
        </div>
        {usageErr && (
          <p role="alert" className="admin-hairline-b px-4 py-2 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="platform-usage-error">{t('platform.usageError')}</p>
        )}
        {tenants.isError ? (
          <p role="alert" className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="platform-error">{t('admin.loadError')}</p>
        ) : tenants.isLoading ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="platform-loading">{t('admin.loading')}</p>
        ) : (tenants.data ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="platform-empty">{t('platform.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="platform-table">
              <thead>
                <tr style={{ background: 'var(--admin-surface-sunken)' }}>
                  <th className={th} style={thStyle}>{t('platform.tenant')}</th>
                  <th className={th} style={thStyle}>{t('platform.deviceDays')}</th>
                  <th className={th} style={thStyle}>{t('platform.activeDevices')}</th>
                </tr>
              </thead>
              <tbody>
                {(tenants.data ?? []).map((tn) => {
                  const u = usageByTenant.get(tn.id)
                  return (
                    <tr key={tn.id} className="admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]" data-testid={`platform-tenant-${tn.id}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium" style={{ color: 'var(--admin-ink)' }}>{tn.name}</div>
                        <div className="mono text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{tn.id}</div>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink)' }}>{usageErr ? '—' : (u?.deviceDays ?? 0)}</td>
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink)' }}>{usageErr ? '—' : (u?.activeDevices ?? 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="admin-hairline-t font-semibold" style={{ background: 'var(--admin-surface-sunken)' }}>
                  <td className="px-4 py-2.5" style={{ color: 'var(--admin-ink)' }}>{t('platform.monthTotal')}</td>
                  <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink)' }}>
                    <span data-testid="platform-total">{usageErr ? '—' : totalDays}</span>
                  </td>
                  <td className="px-4 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="admin-hairline-t px-4 py-3 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('platform.note')}</p>
      </div>
    </div>
  )
}
