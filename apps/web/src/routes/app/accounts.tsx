import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Plus, UserPlus } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, Badge as AdminBadge, PageHeader } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  createAccount,
  createUser,
  deleteAccount,
  deleteUser,
  listUsers,
  renameAccount,
  type UserView,
} from '@/lib/accounts'
import { setAccountContext } from '@/lib/accountContext'
import { getCurrentUser } from '@/lib/auth'
import { listAccounts, type Account } from '@/lib/devices'

/** The short list settings.tsx offers for the account timezone — duplicated rather than exported
 *  from a route file; the schema accepts any IANA zone, this is only the picker's convenience. */
const COMMON_TIMEZONES = ['Europe/Vilnius', 'Europe/Warsaw', 'Europe/Berlin', 'Europe/Riga', 'Europe/Tallinn', 'UTC'] as const

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')

/**
 * Customer accounts (the reseller surface) — E03's API finally gets its page.
 *
 * A TSP's whole model is "one account per customer": the pricing card promises it, the entitlement
 * gates it, devices/drivers/geofences all scope to it — and until this page, creating one took a
 * platform admin or a curl. The founder found that out minutes after the first real TSP checkout.
 *
 * Layout mirrors drivers.tsx (ADR-028): header Sheet for create/edit, shared DataTable, per-row "…"
 * popover, ConfirmDialog for deletes. Below the accounts sits the LOGINS table — the users the
 * reseller hands to customers — because an account without a login is not yet a customer.
 */
export function AccountsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const me = getCurrentUser()
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const [addOpen, setAddOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [userForAccount, setUserForAccount] = useState<string | null>(null) // account id the new login lands in
  const [deleteForId, setDeleteForId] = useState<string | null>(null)
  const [deleteUserForId, setDeleteUserForId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // the API additionally enforces both of these (tenant-wide + role tier); this only decides what to render
  const canWrite = me?.role === 'platform_admin' || me?.role === 'tsp_admin'

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['accounts'] })
    void qc.invalidateQueries({ queryKey: ['users'] })
  }

  // live-list resolution (devices/drivers precedent): never leave a sheet or confirm on a stale row
  const editing = (accounts.data ?? []).find((a) => a.id === editingId) ?? null
  const deleteFor = (accounts.data ?? []).find((a) => a.id === deleteForId) ?? null
  const deleteUserFor = (users.data ?? []).find((u) => u.id === deleteUserForId) ?? null
  const formOpen = addOpen || editing !== null
  const closeForm = () => {
    setAddOpen(false)
    setEditingId(null)
  }

  const usersIn = (accountId: string) => (users.data ?? []).filter((u) => u.accountId === accountId).length

  const accountColumns: Column<Account>[] = [
    {
      key: 'name',
      header: t('accounts.name'),
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
            style={{ background: 'var(--admin-brand-soft)', color: 'var(--admin-brand)' }}
            aria-hidden
          >
            {initials(r.name)}
          </div>
          <span className="font-medium">{r.name}</span>
        </div>
      ),
    },
    {
      key: 'timezone',
      header: t('accounts.timezone'),
      hideOnMobile: true,
      cell: (r) => <span className="mono text-xs">{r.timezone ?? 'UTC'}</span>,
    },
    {
      key: 'logins',
      header: t('accounts.logins'),
      sortable: true,
      sortValue: (r) => usersIn(r.id),
      align: 'right',
      cell: (r) => <span className="tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{usersIn(r.id)}</span>,
    },
  ]

  const roleTone = { platform_admin: 'danger', tsp_admin: 'warning', account_manager: 'success', viewer: 'neutral' } as const
  const userColumns: Column<UserView>[] = [
    {
      key: 'email',
      header: t('accounts.userEmail'),
      sortable: true,
      sortValue: (r) => r.email.toLowerCase(),
      cell: (r) => <span className="font-medium">{r.email}</span>,
    },
    {
      key: 'account',
      header: t('accounts.account'),
      sortable: true,
      sortValue: (r) => (r.accountId === null ? '' : ((accounts.data ?? []).find((a) => a.id === r.accountId)?.name ?? '').toLowerCase()),
      cell: (r) =>
        r.accountId === null ? (
          <span style={{ color: 'var(--admin-ink-soft)' }}>{t('accounts.tenantWide')}</span>
        ) : (
          ((accounts.data ?? []).find((a) => a.id === r.accountId)?.name ?? '—')
        ),
    },
    {
      key: 'role',
      header: t('accounts.role'),
      sortable: true,
      sortValue: (r) => r.role,
      cell: (r) => <AdminBadge tone={roleTone[r.role]}>{t(`accounts.roles.${r.role}`)}</AdminBadge>,
    },
  ]

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('accounts.title')} description={t('accounts.desc')}>
        {canWrite && (
          <Sheet
            open={formOpen}
            onOpenChange={(o) => {
              if (o) setAddOpen(true)
              else closeForm()
            }}
          >
            <SheetTrigger asChild>
              <AdminButton data-testid="account-add-open">
                <Plus className="h-4 w-4" aria-hidden />
                {t('accounts.add')}
              </AdminButton>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader>
                <SheetTitle>{editing !== null ? t('accounts.editTitle') : t('accounts.addTitle')}</SheetTitle>
              </SheetHeader>
              <AccountForm
                key={editing?.id ?? 'new'}
                editing={editing}
                onDone={() => {
                  closeForm()
                  refresh()
                }}
                onCancel={closeForm}
              />
            </SheetContent>
          </Sheet>
        )}
      </PageHeader>

      {accounts.isLoading ? (
        <div className="admin-card space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : accounts.isError ? (
        <p className="text-sm" style={{ color: 'var(--admin-danger)' }}>{t('accounts.loadError')}</p>
      ) : (
        <>
          {actionError !== null && (
            <p role="alert" className="mb-2 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="accounts-action-error">
              {actionError}
            </p>
          )}
          <DataTable
            data-testid="accounts-table"
            data={accounts.data ?? []}
            columns={accountColumns}
            searchKeys={['name']}
            pageSize={10}
            emptyLabel={t('accounts.empty')}
            rowTestId={(a) => `account-${a.id}`}
            rowAction={
              canWrite
                ? (a) => (
                    <AccountRowMenu
                      account={a}
                      onEdit={() => setEditingId(a.id)}
                      onAddUser={() => setUserForAccount(a.id)}
                      onDelete={() => setDeleteForId(a.id)}
                    />
                  )
                : undefined
            }
          />
        </>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('accounts.usersTitle')}</h2>
        {users.isLoading ? (
          <div className="admin-card p-4">
            <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('accounts.loading')}</p>
          </div>
        ) : users.isError ? (
          <div className="admin-card p-4">
            <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }}>{t('accounts.loadError')}</p>
          </div>
        ) : (
          <DataTable
            data-testid="account-users-table"
            data={users.data ?? []}
            columns={userColumns}
            searchKeys={['email']}
            pageSize={10}
            emptyLabel={t('accounts.usersEmpty')}
            rowTestId={(u) => `account-user-${u.id}`}
            rowAction={
              canWrite
                ? (u) =>
                    // tier rule mirrored from the API (canManageUser): admins act on STRICTLY lower
                    // tiers, and never on themselves from this table
                    u.id !== me?.id && (u.role === 'account_manager' || u.role === 'viewer') ? (
                      <button
                        type="button"
                        aria-label={t('accounts.deleteUser')}
                        data-testid={`account-user-delete-${u.id}`}
                        onClick={() => setDeleteUserForId(u.id)}
                        className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-[var(--admin-surface-sunken)]"
                      >
                        <MoreHorizontal className="h-4 w-4" style={{ color: 'var(--admin-ink-soft)' }} aria-hidden />
                      </button>
                    ) : null
                : undefined
            }
          />
        )}
      </div>

      {/* the login sheet is page-level: opened from an account row, prefilled with that account */}
      <Sheet open={userForAccount !== null} onOpenChange={(o) => { if (!o) setUserForAccount(null) }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('accounts.addUserTitle')}</SheetTitle>
          </SheetHeader>
          {userForAccount !== null && (
            <UserForm
              key={userForAccount}
              accounts={accounts.data ?? []}
              initialAccountId={userForAccount}
              onDone={() => {
                setUserForAccount(null)
                refresh()
              }}
              onCancel={() => setUserForAccount(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleteFor !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteForId(null)
        }}
        tone="danger"
        title={t('accounts.delete')}
        description={deleteFor !== null ? t('accounts.deleteSure', { name: deleteFor.name }) : undefined}
        confirmLabel={t('accounts.delete')}
        onConfirm={() => {
          const a = deleteFor
          if (a === null) return
          setActionError(null)
          void deleteAccount(a.id).then(refresh).catch(() => setActionError(t('accounts.deleteError')))
        }}
      />
      <ConfirmDialog
        open={deleteUserFor !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteUserForId(null)
        }}
        tone="danger"
        title={t('accounts.deleteUser')}
        description={deleteUserFor !== null ? t('accounts.deleteUserSure', { email: deleteUserFor.email }) : undefined}
        confirmLabel={t('accounts.deleteUser')}
        onConfirm={() => {
          const u = deleteUserFor
          if (u === null) return
          setActionError(null)
          void deleteUser(u.id).then(refresh).catch(() => setActionError(t('accounts.deleteError')))
        }}
      />
    </div>
  )
}

function AccountRowMenu({ account, onEdit, onAddUser, onDelete }: { account: Account; onEdit: () => void; onAddUser: () => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const item = (testid: string, label: ReactNode, onClick: () => void, danger = false) => (
    <button
      type="button"
      data-testid={testid}
      onClick={() => {
        setOpen(false)
        onClick()
      }}
      className="block w-full rounded px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[var(--admin-surface-sunken)]"
      style={{ color: danger ? 'var(--admin-danger)' : 'var(--admin-ink)' }}
    >
      {label}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('accounts.actions')}
          data-testid={`account-menu-${account.id}`}
          className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-[var(--admin-surface-sunken)]"
        >
          <MoreHorizontal className="h-4 w-4" style={{ color: 'var(--admin-ink-soft)' }} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        {item(`account-actfor-${account.id}`, t('accounts.actFor'), () => setAccountContext(account.id))}
        {item(`account-adduser-${account.id}`, (
          <span className="flex items-center gap-2"><UserPlus className="h-3.5 w-3.5" aria-hidden />{t('accounts.addUser')}</span>
        ), onAddUser)}
        {item(`account-edit-${account.id}`, t('accounts.edit'), onEdit)}
        {item(`account-delete-${account.id}`, t('accounts.delete'), onDelete, true)}
      </PopoverContent>
    </Popover>
  )
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: 'var(--admin-ink-soft)' }}>
      {label}
      {children}
    </label>
  )
}

function AccountForm({ editing, onDone, onCancel }: { editing: Account | null; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(editing?.name ?? '')
  const [timezone, setTimezone] = useState(editing?.timezone ?? 'Europe/Vilnius')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tzOptions = [
    ...COMMON_TIMEZONES.map((z) => ({ value: z, label: z })),
    ...(!(COMMON_TIMEZONES as readonly string[]).includes(timezone) ? [{ value: timezone, label: timezone }] : []),
  ]

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (name.trim() === '') { setError(t('accounts.nameRequired')); return }
    setBusy(true)
    try {
      // rename touches ONLY the name — the timezone re-cuts every report's day boundary, so an
      // account's zone changes in settings, deliberately, not as a side effect of a rename
      if (editing) await renameAccount(editing.id, name.trim())
      else await createAccount({ name: name.trim(), timezone })
      onDone()
    } catch {
      setError(t('accounts.saveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-col gap-3" data-testid="account-form">
      <FieldLabel label={t('accounts.name')}>
        <AdminInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="account-name" />
      </FieldLabel>
      {!editing && (
        <FieldLabel label={t('accounts.timezone')}>
          <Combobox value={timezone} onChange={setTimezone} data-testid="account-timezone" aria-label={t('accounts.timezone')} options={tzOptions} />
        </FieldLabel>
      )}
      {error !== null && <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="account-error">{error}</p>}
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('accounts.cancel')}</AdminButton>
        <AdminButton type="submit" disabled={busy} data-testid="account-save">{editing ? t('accounts.save') : t('accounts.create')}</AdminButton>
      </SheetFooter>
    </form>
  )
}

function UserForm({ accounts, initialAccountId, onDone, onCancel }: {
  accounts: Account[]
  initialAccountId: string
  onDone: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'account_manager' | 'viewer'>('account_manager')
  const [accountId, setAccountId] = useState(initialAccountId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!email.includes('@')) { setError(t('accounts.emailRequired')); return }
    if (password.length < 8) { setError(t('accounts.passwordShort')); return }
    setBusy(true)
    try {
      await createUser({ email: email.trim(), password, role, accountId })
      onDone()
    } catch {
      setError(t('accounts.userSaveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-col gap-3" data-testid="account-user-form">
      <FieldLabel label={t('accounts.account')}>
        <Combobox value={accountId} onChange={setAccountId} data-testid="account-user-account" aria-label={t('accounts.account')} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
      </FieldLabel>
      <FieldLabel label={t('accounts.userEmail')}>
        <AdminInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} data-testid="account-user-email" />
      </FieldLabel>
      <FieldLabel label={t('accounts.userPassword')}>
        <AdminInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} data-testid="account-user-password" />
      </FieldLabel>
      <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('accounts.passwordHint')}</p>
      <FieldLabel label={t('accounts.role')}>
        <Combobox
          value={role}
          onChange={(v) => setRole(v === 'viewer' ? 'viewer' : 'account_manager')}
          data-testid="account-user-role"
          aria-label={t('accounts.role')}
          options={[
            { value: 'account_manager', label: t('accounts.roles.account_manager') },
            { value: 'viewer', label: t('accounts.roles.viewer') },
          ]}
        />
      </FieldLabel>
      {error !== null && <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="account-user-error">{error}</p>}
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('accounts.cancel')}</AdminButton>
        <AdminButton type="submit" disabled={busy} data-testid="account-user-save">{t('accounts.createUser')}</AdminButton>
      </SheetFooter>
    </form>
  )
}
