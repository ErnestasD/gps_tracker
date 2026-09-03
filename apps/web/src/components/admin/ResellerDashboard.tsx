import { TSP_INCLUDED_DEVICES } from '@orbetra/shared'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { AdminButton, Badge as AdminBadge, PageHeader, StatCard } from '@/components/admin/AdminKit'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { Skeleton } from '@/components/ui/skeleton'
import { listAccountUsage, listUsers } from '@/lib/accounts'
import { setAccountContext } from '@/lib/accountContext'
import { getCurrentUser } from '@/lib/auth'
import { listAccounts, listDevices, type Account } from '@/lib/devices'

/** First day of the current UTC month — the allowance meter's period. */
const monthStart = (): string => new Date().toISOString().slice(0, 8) + '01'

/**
 * The overseer's home (TSP UX audit 2026-09-03).
 *
 * A reseller who has just paid €149 does not open the product to watch somebody's vans — they open
 * it to answer "how is my business doing": which customers, how many devices against my plan's
 * allowance, who is active, who has logins. The operator dashboard stays exactly as it was for
 * Direct tenants and for account-scoped users; this variant renders only for a tenant-wide admin
 * of a sub-account plan (the same predicate that shows the context switcher).
 */
export function ResellerDashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const me = getCurrentUser()
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const usage = useQuery({ queryKey: ['usage-accounts', monthStart()], queryFn: () => listAccountUsage(monthStart()), refetchInterval: 5 * 60_000 })

  const live = (devices.data ?? []).filter((d) => d.retiredAt === null)
  const allowance = me !== null ? TSP_INCLUDED_DEVICES[me.plan] : null
  const usageByAccount = new Map((usage.data ?? []).map((u) => [u.accountId, u]))
  // a device belongs to exactly one account, so the tenant's active count is the exact sum
  const activeMtd = (usage.data ?? []).reduce((a, u) => a + u.activeDevices, 0)
  const deviceDaysMtd = (usage.data ?? []).reduce((a, u) => a + u.deviceDays, 0)
  const overAllowance = allowance !== null && live.length > allowance

  const columns: Column<Account>[] = [
    {
      key: 'name',
      header: t('reseller.customer'),
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: 'devices',
      header: t('reseller.devices'),
      sortable: true,
      sortValue: (r) => live.filter((d) => d.accountId === r.id).length,
      align: 'right',
      cell: (r) => <span className="tabular-nums">{live.filter((d) => d.accountId === r.id).length}</span>,
    },
    {
      key: 'active',
      header: t('reseller.activeMtd'),
      sortable: true,
      sortValue: (r) => usageByAccount.get(r.id)?.activeDevices ?? 0,
      align: 'right',
      hideOnMobile: true,
      cell: (r) => <span className="tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{usageByAccount.get(r.id)?.activeDevices ?? 0}</span>,
    },
    {
      key: 'deviceDays',
      header: t('reseller.deviceDays'),
      sortable: true,
      sortValue: (r) => usageByAccount.get(r.id)?.deviceDays ?? 0,
      align: 'right',
      hideOnMobile: true,
      cell: (r) => <span className="tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{usageByAccount.get(r.id)?.deviceDays ?? 0}</span>,
    },
    {
      key: 'logins',
      header: t('reseller.logins'),
      align: 'right',
      hideOnMobile: true,
      cell: (r) => <span className="tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{(users.data ?? []).filter((u) => u.accountId === r.id).length}</span>,
    },
    {
      key: 'act',
      header: '',
      align: 'right',
      cell: (r) => (
        <AdminButton
          size="sm"
          variant="secondary"
          data-testid={`reseller-actfor-${r.id}`}
          onClick={() => {
            setAccountContext(r.id)
            void navigate({ to: '/app' }) // the map lives at /app
          }}
        >
          {t('reseller.open')}
        </AdminButton>
      ),
    },
  ]

  return (
    <div className="w-full space-y-4 p-4 md:p-6" data-testid="reseller-dashboard">
      <PageHeader className="mb-0" title={t('reseller.title')} description={t('reseller.desc')}>
        <AdminButton variant="secondary" onClick={() => void navigate({ to: '/app/accounts' })} data-testid="reseller-to-accounts">
          {t('reseller.manageAccounts')}
        </AdminButton>
        <AdminButton onClick={() => void navigate({ to: '/app/devices' })}>{t('reseller.toDevices')}</AdminButton>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('reseller.customers')} value={accounts.data?.length ?? '—'} />
        <StatCard
          label={t('reseller.devicesTotal')}
          value={
            allowance !== null ? (
              <span className="flex items-baseline gap-1.5">
                {live.length}
                <span className="text-sm font-normal" style={{ color: overAllowance ? 'var(--admin-warning)' : 'var(--admin-ink-soft)' }}>/ {allowance}</span>
              </span>
            ) : (
              live.length
            )
          }
          hint={overAllowance ? t('reseller.overAllowance', { n: live.length - (allowance ?? 0) }) : t('reseller.allowanceHint')}
        />
        <StatCard label={t('reseller.activeMtdLong')} value={activeMtd} hint={t('reseller.mtd')} />
        <StatCard label={t('reseller.deviceDaysLong')} value={deviceDaysMtd} hint={t('reseller.mtd')} />
      </div>

      {accounts.isLoading || devices.isLoading ? (
        <div className="admin-card space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : accounts.isError ? (
        <p className="text-sm" style={{ color: 'var(--admin-danger)' }}>{t('reseller.loadError')}</p>
      ) : (accounts.data ?? []).length === 0 ? (
        <div className="admin-card flex flex-col items-start gap-3 p-6">
          <AdminBadge tone="neutral">{t('reseller.emptyBadge')}</AdminBadge>
          <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('reseller.emptyBody')}</p>
          <AdminButton onClick={() => void navigate({ to: '/app/accounts' })} data-testid="reseller-first-account">
            {t('reseller.firstAccount')}
          </AdminButton>
        </div>
      ) : (
        <DataTable
          data-testid="reseller-accounts-table"
          data={accounts.data ?? []}
          columns={columns}
          searchKeys={['name']}
          pageSize={10}
          emptyLabel={t('reseller.emptyBody')}
          rowTestId={(a) => `reseller-account-${a.id}`}
        />
      )}
    </div>
  )
}
