import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, Badge, PageHeader } from '@/components/admin/AdminKit'
import { getCurrentUser } from '@/lib/auth'
import { useFmt } from '@/lib/datetime'
import { consoleUsers, setUserDisabled, type ConsoleUser } from '@/lib/console'

/**
 * Everyone with a login, across every tenant.
 *
 * Sorted by last login, most recent first, with never-logged-in seats last — the question this page
 * answers is "who is actually using the product", and a page of dormant invitations would bury it.
 * `lastLoginAt` did not exist before this console; a user row only ever proved that an account had
 * been created.
 */
const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const td = 'px-4 py-2.5'

export function ConsoleUsersPage() {
  const { t } = useTranslation()
  const fmt = useFmt()
  const qc = useQueryClient()
  const me = getCurrentUser()
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const q = useQuery({ queryKey: ['console', 'users', search], queryFn: () => consoleUsers(search) })
  const toggle = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) => setUserDisabled(id, disabled),
    onSuccess: () => {
      setError(null)
      void qc.invalidateQueries({ queryKey: ['console', 'users'] })
      void qc.invalidateQueries({ queryKey: ['console', 'overview'] })
    },
    onError: () => setError(t('console.users.actionError')),
  })

  const rows: ConsoleUser[] = q.data ?? []

  return (
    <div className="flex flex-col gap-6" data-testid="console-users">
      <PageHeader title={t('console.users.title')} description={t('console.users.desc')} />

      <AdminInput
        type="search"
        value={search}
        placeholder={t('console.users.searchPlaceholder')}
        aria-label={t('console.users.searchPlaceholder')}
        onChange={(e) => setSearch(e.currentTarget.value)}
        className="max-w-sm"
        data-testid="console-users-search"
      />

      {error !== null && (
        <p role="alert" className="admin-card p-3 text-sm" style={{ color: 'var(--admin-danger)' }}>
          {error}
        </p>
      )}
      {q.isError && (
        <p role="alert" className="admin-card p-4 text-sm" style={{ color: 'var(--admin-danger)' }}>
          {t('console.loadError')}
        </p>
      )}

      <div className="admin-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="admin-hairline-b">
              <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.users.email')}</th>
              <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.users.tenant')}</th>
              <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.users.role')}</th>
              <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.users.lastLogin')}</th>
              <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.users.status')}</th>
              <th className={th} style={{ color: 'var(--admin-ink-soft)' }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const self = u.id === me?.id
              const disabled = u.disabledAt !== null
              return (
                <tr key={u.id} className="admin-hairline-b" data-testid={`console-user-${u.id}`}>
                  <td className={`${td} font-medium`} style={{ color: 'var(--admin-ink)' }}>{u.email}</td>
                  <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>{u.tenantName}</td>
                  <td className={td}>
                    <Badge tone={u.role === 'platform_admin' ? 'brand' : 'neutral'}>{u.role}</Badge>
                  </td>
                  <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>
                    {u.lastLoginAt === null ? t('console.users.never') : fmt.dt(u.lastLoginAt)}
                  </td>
                  <td className={td}>
                    {disabled ? (
                      <Badge tone="danger">{t('console.users.disabled')}</Badge>
                    ) : u.emailVerifiedAt === null ? (
                      <Badge tone="warning">{t('console.users.unverified')}</Badge>
                    ) : (
                      <Badge tone="success">{t('console.users.active')}</Badge>
                    )}
                  </td>
                  <td className={`${td} text-right`}>
                    {/* Disabling YOURSELF is refused by the server too — the only way back from
                        locking out the last platform admin is a database console. */}
                    <AdminButton
                      variant="ghost"
                      size="sm"
                      disabled={self || toggle.isPending}
                      title={self ? t('console.users.cannotDisableSelf') : undefined}
                      onClick={() => toggle.mutate({ id: u.id, disabled: !disabled })}
                      data-testid={`console-user-toggle-${u.id}`}
                    >
                      {disabled ? t('console.users.enable') : t('console.users.disable')}
                    </AdminButton>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
