import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getCurrentUser } from '@/lib/auth'
import { listTenants } from '@/lib/devices'
import { monthStartUtc, platformUsage } from '@/lib/usage'

/**
 * Platform admin panel (E07-4, W7 S4): tenants + usage (billable device-days this UTC month).
 * platform_admin only — the in-page gate mirrors quarantine; the server 403s everyone else.
 */
export function PlatformPage() {
  const { t } = useTranslation()
  const isPlatform = getCurrentUser()?.role === 'platform_admin'
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: listTenants, enabled: isPlatform })
  const usage = useQuery({ queryKey: ['platform-usage'], queryFn: () => platformUsage(monthStartUtc()), enabled: isPlatform })

  if (!isPlatform) {
    return <div className="p-6 text-sm text-muted" data-testid="platform-denied">{t('platform.denied')}</div>
  }

  const usageByTenant = new Map((usage.data ?? []).map((u) => [u.tenantId, u]))
  const totalDays = (usage.data ?? []).reduce((s, u) => s + u.deviceDays, 0)

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">{t('platform.title')}</h1>

      <Card>
        <CardHeader className="flex-row items-center space-y-0">
          <CardTitle className="text-base">{t('platform.tenants')}</CardTitle>
          <span className="ml-auto text-xs text-muted" data-testid="platform-total">{t('platform.monthTotal')}: {totalDays}</span>
        </CardHeader>
        <CardContent>
          {(tenants.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted" data-testid="platform-empty">{t('platform.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="platform-table">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">{t('platform.tenant')}</th>
                    <th className="py-2 pr-3 font-medium">{t('platform.deviceDays')}</th>
                    <th className="py-2 pr-3 font-medium">{t('platform.activeDevices')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(tenants.data ?? []).map((tn) => {
                    const u = usageByTenant.get(tn.id)
                    return (
                      <tr key={tn.id} className="border-b border-line/60" data-testid={`platform-tenant-${tn.id}`}>
                        <td className="py-2 pr-3 font-medium">{tn.name}</td>
                        <td className="py-2 pr-3 tabular-nums">{u?.deviceDays ?? 0}</td>
                        <td className="py-2 pr-3 tabular-nums">{u?.activeDevices ?? 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="pt-3 text-xs text-muted">{t('platform.note')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
