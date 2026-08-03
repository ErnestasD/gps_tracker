import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Handshake, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, AdminLabel, Badge, EmptyState, PageHeader } from '@/components/admin/AdminKit'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
  createAffiliate,
  listAffiliates,
  listCommissions,
  setCommissionStatus,
  updateAffiliate,
  type AffiliateStatus,
  type AffiliateView,
  type CommissionStatus,
} from '@/lib/affiliates'
import { getCurrentUser } from '@/lib/auth'
import { useFmt } from '@/lib/datetime'

const STATUS_TONE: Record<AffiliateStatus, 'success' | 'warning' | 'neutral'> = { active: 'success', pending: 'warning', suspended: 'neutral' }
const COMMISSION_TONE: Record<CommissionStatus, 'warning' | 'success' | 'neutral'> = { pending: 'warning', paid: 'success', void: 'neutral' }
const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`

/**
 * Affiliate/partner management (item 5 / W9 phase 3), platform_admin only. Invite-only: an admin
 * invites a partner (referral code auto-generated when blank, status starts `pending`) then
 * activates it so the code attributes new tenants (F4). Per-partner commissions drill-down lets
 * the admin mark a commission paid at payout time. The in-page gate mirrors the platform panel;
 * the server 403s everyone else regardless.
 */
export function AffiliatesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isPlatform = getCurrentUser()?.role === 'platform_admin'
  const affiliates = useQuery({ queryKey: ['affiliates'], queryFn: listAffiliates, enabled: isPlatform })
  const [addOpen, setAddOpen] = useState(false)
  const [openFor, setOpenFor] = useState<string | null>(null) // expanded commissions panel

  const refresh = () => void qc.invalidateQueries({ queryKey: ['affiliates'] })
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AffiliateStatus }) => updateAffiliate(id, { status }),
    onSuccess: refresh,
  })

  if (!isPlatform) {
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="affiliates-denied">
        {t('affiliates.denied')}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('affiliates.title')} description={t('affiliates.desc')}>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <AdminButton data-testid="affiliate-add-open">
              <Plus className="h-4 w-4" aria-hidden />
              {t('affiliates.invite')}
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{t('affiliates.inviteTitle')}</SheetTitle>
            </SheetHeader>
            <AffiliateForm
              onCreated={() => {
                setAddOpen(false)
                refresh()
              }}
              onCancel={() => setAddOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </PageHeader>

      {setStatus.isError && (
        <p role="alert" className="admin-card p-3 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="affiliates-action-error">{t('affiliates.actionError')}</p>
      )}

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('affiliates.list')}
        </div>
        {affiliates.isError ? (
          <p role="alert" className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="affiliates-error">{t('admin.loadError')}</p>
        ) : affiliates.isLoading ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="affiliates-loading">{t('admin.loading')}</p>
        ) : (affiliates.data ?? []).length === 0 ? (
          <EmptyState icon={<Handshake className="h-5 w-5" />} title={t('affiliates.empty')} description={t('affiliates.emptyDesc')} data-testid="affiliates-empty" />
        ) : (
          <ul data-testid="affiliates-list">
            {(affiliates.data ?? []).map((a) => (
              <li key={a.id} className="admin-hairline-b last:border-b-0" data-testid={`affiliate-${a.id}`}>
                <div className="flex flex-wrap items-center gap-3 p-4 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" style={{ color: 'var(--admin-ink)' }}>{a.name}</div>
                    <div className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{a.email}</div>
                  </div>
                  <code className="mono rounded-md border px-2 py-1 text-xs" style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }} data-testid={`affiliate-code-${a.id}`}>{a.code}</code>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{t('affiliates.terms', { pct: Number(a.commissionPct), months: a.commissionMonths })}</span>
                  <Badge tone={STATUS_TONE[a.status]} data-testid={`affiliate-status-${a.id}`}>{t(`affiliates.status.${a.status}`)}</Badge>
                  {a.status !== 'active' ? (
                    <AdminButton size="sm" variant="secondary" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: a.id, status: 'active' })} data-testid={`affiliate-activate-${a.id}`}>
                      {t('affiliates.activate')}
                    </AdminButton>
                  ) : (
                    <AdminButton size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: a.id, status: 'suspended' })} data-testid={`affiliate-suspend-${a.id}`}>
                      {t('affiliates.suspend')}
                    </AdminButton>
                  )}
                  <AdminButton size="sm" variant="ghost" onClick={() => setOpenFor(openFor === a.id ? null : a.id)} data-testid={`affiliate-commissions-toggle-${a.id}`}>
                    {t('affiliates.commissions')}
                  </AdminButton>
                </div>
                {openFor === a.id && <CommissionsPanel affiliate={a} />}
              </li>
            ))}
          </ul>
        )}
        <p className="admin-hairline-t px-4 py-3 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('affiliates.note')}</p>
      </div>
    </div>
  )
}

/** Per-affiliate commissions (accrued from referred tenants' payments); mark one paid at payout. */
function CommissionsPanel({ affiliate }: { affiliate: AffiliateView }) {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const qc = useQueryClient()
  const commissions = useQuery({ queryKey: ['commissions', affiliate.id], queryFn: () => listCommissions(affiliate.id) })
  const markPaid = useMutation({
    mutationFn: (id: string) => setCommissionStatus(id, 'paid'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['commissions', affiliate.id] }),
  })

  return (
    <div className="px-4 pb-4" data-testid={`affiliate-commissions-${affiliate.id}`} style={{ background: 'var(--admin-surface-sunken)' }}>
      {commissions.isError ? (
        <p role="alert" className="py-4 text-center text-xs" style={{ color: 'var(--admin-danger)' }}>{t('admin.loadError')}</p>
      ) : commissions.isLoading ? (
        <p className="py-4 text-center text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('admin.loading')}</p>
      ) : (commissions.data ?? []).length === 0 ? (
        <p className="py-4 text-center text-xs" style={{ color: 'var(--admin-ink-soft)' }} data-testid={`affiliate-commissions-empty-${affiliate.id}`}>{t('affiliates.noCommissions')}</p>
      ) : (
        <table className="w-full text-xs" data-testid={`affiliate-commissions-table-${affiliate.id}`}>
          <thead>
            <tr style={{ color: 'var(--admin-ink-soft)' }}>
              <th className="px-2 py-1.5 text-left font-semibold">{t('affiliates.date')}</th>
              <th className="px-2 py-1.5 text-left font-semibold">{t('affiliates.amount')}</th>
              <th className="px-2 py-1.5 text-left font-semibold">{t('affiliates.invoice')}</th>
              <th className="px-2 py-1.5 text-left font-semibold">{t('affiliates.status.label')}</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {(commissions.data ?? []).map((cm) => (
              <tr key={cm.id} className="admin-hairline-t" data-testid={`commission-${cm.id}`}>
                <td className="px-2 py-1.5 tabular-nums" style={{ color: 'var(--admin-ink)' }}>{dt(cm.createdAt)}</td>
                <td className="px-2 py-1.5 tabular-nums" style={{ color: 'var(--admin-ink)' }}>{money(cm.amountCents, cm.currency)}</td>
                <td className="px-2 py-1.5"><span className="mono" style={{ color: 'var(--admin-ink-soft)' }}>{cm.sourceInvoiceId}</span></td>
                <td className="px-2 py-1.5"><Badge tone={COMMISSION_TONE[cm.status]}>{t(`affiliates.commissionStatus.${cm.status}`)}</Badge></td>
                <td className="px-2 py-1.5 text-right">
                  {cm.status === 'pending' && (
                    <AdminButton size="sm" variant="secondary" disabled={markPaid.isPending} onClick={() => markPaid.mutate(cm.id)} data-testid={`commission-pay-${cm.id}`}>
                      {t('affiliates.markPaid')}
                    </AdminButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Invite form inside the header Sheet: name + email required; code/terms optional (server fills
 * a CSPRNG code + default 20%/12mo when blank). */
function AffiliateForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pct, setPct] = useState('')
  const [months, setMonths] = useState('')

  const create = useMutation({
    mutationFn: () =>
      createAffiliate({
        name: name.trim(),
        email: email.trim(),
        ...(code.trim() ? { code: code.trim() } : {}),
        ...(pct.trim() ? { commissionPct: Number(pct) } : {}),
        ...(months.trim() ? { commissionMonths: Number(months) } : {}),
      }),
    onSuccess: onCreated,
  })

  const valid = name.trim() !== '' && /.+@.+\..+/.test(email.trim())
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!valid || create.isPending) return
    create.mutate()
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
      <div>
        <AdminLabel htmlFor="affiliate-name">{t('affiliates.name')}</AdminLabel>
        <AdminInput id="affiliate-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="affiliate-name" className="w-full" />
      </div>
      <div>
        <AdminLabel htmlFor="affiliate-email">{t('affiliates.email')}</AdminLabel>
        <AdminInput id="affiliate-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="affiliate-email" className="w-full" />
      </div>
      <div>
        <AdminLabel htmlFor="affiliate-code">{t('affiliates.code')}</AdminLabel>
        <AdminInput id="affiliate-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('affiliates.codeAuto')} data-testid="affiliate-code" className="w-full" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <AdminLabel htmlFor="affiliate-pct">{t('affiliates.pct')}</AdminLabel>
          <AdminInput id="affiliate-pct" type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} placeholder="20" data-testid="affiliate-pct" className="w-full" />
        </div>
        <div className="flex-1">
          <AdminLabel htmlFor="affiliate-months">{t('affiliates.months')}</AdminLabel>
          <AdminInput id="affiliate-months" type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} placeholder="12" data-testid="affiliate-months" className="w-full" />
        </div>
      </div>
      {create.isError && (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="affiliate-error">{t('affiliates.createError')}</p>
      )}
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('admin.cancel')}</AdminButton>
        <AdminButton type="submit" disabled={!valid || create.isPending} data-testid="affiliate-create">
          {t('affiliates.create')}
        </AdminButton>
      </SheetFooter>
    </form>
  )
}
