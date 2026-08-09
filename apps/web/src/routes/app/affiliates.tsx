import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Handshake, KeyRound, Pencil, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, AdminLabel, Badge, EmptyState, PageHeader } from '@/components/admin/AdminKit'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
  buildAffiliatePatch,
  createAffiliate,
  decideDeal,
  listDeals,
  issuePartnerLoginLink,
  listAffiliates,
  listCommissions,
  setCommissionStatus,
  updateAffiliate,
  type AffiliateStatus,
  type AffiliateView,
  type AffiliateWithStats,
  type CommissionStatus,
  type DealView,
} from '@/lib/affiliates'
import { getCurrentUser } from '@/lib/auth'
import { ApiError } from '@/lib/http'
import { useFmt } from '@/lib/datetime'

const STATUS_TONE: Record<AffiliateStatus, 'success' | 'warning' | 'neutral'> = { active: 'success', pending: 'warning', suspended: 'neutral' }
const COMMISSION_TONE: Record<CommissionStatus, 'warning' | 'success' | 'neutral'> = { pending: 'warning', paid: 'success', void: 'neutral' }
const DEAL_TONE: Record<DealView['status'], 'warning' | 'success' | 'neutral'> = { pending: 'warning', approved: 'success', converted: 'success', rejected: 'neutral' }
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

      <DealQueue />

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
                  <EditPartner affiliate={a} onSaved={refresh} />
                  <LoginLinkButton affiliate={a} />
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
                <PartnerStats affiliate={a} />
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

/**
 * The deal-registration queue: partners claiming prospects they introduced in person.
 *
 * THIS IS THE ANTI-LAND-GRAB CONTROL. Approving a claim gives that partner every signup on that
 * email domain for ninety days, whether or not they had anything to do with it — so the decision is
 * a money decision, the server audits it, and a domain another partner already holds is refused
 * (409) rather than silently promised to two people.
 *
 * Pending claims sort to the top because they are the only rows that need anything from anyone.
 */
function DealQueue() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const qc = useQueryClient()
  const deals = useQuery({ queryKey: ['deals'], queryFn: listDeals })
  const decide = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: 'approved' | 'rejected'; reason?: string }) => decideDeal(id, status, reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['deals'] }),
  })

  const rows = [...(deals.data ?? [])].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'))
  const pending = rows.filter((d) => d.status === 'pending').length
  if (deals.isLoading || (rows.length === 0 && !deals.isError)) return null // an empty queue is not worth a card

  return (
    <div className="admin-card overflow-hidden" data-testid="deal-queue">
      <div className="admin-hairline-b flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <span className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('affiliates.deals')}</span>
        {pending > 0 && <Badge tone="warning" data-testid="deal-pending-count">{t('affiliates.dealsPending', { count: pending })}</Badge>}
      </div>
      {deals.isError ? (
        <p role="alert" className="px-4 py-6 text-center text-sm" style={{ color: 'var(--admin-danger)' }}>{t('admin.loadError')}</p>
      ) : (
        <ul>
          {rows.map((d) => (
            <li key={d.id} className="admin-hairline-b last:border-b-0 px-4 py-3 text-sm" data-testid={`deal-${d.id}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium" style={{ color: 'var(--admin-ink)' }}>{d.company}</div>
                  <div className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                    <code className="mono">{d.domain}</code> · {t('affiliates.dealBy', { name: d.affiliateName })} · {dt(d.createdAt)}
                  </div>
                  {/* the two facts the decision actually turns on. Approving hands this partner
                      every signup on that domain for ninety days, and the queue used to show
                      nothing that would tell an admin whether that was reasonable. */}
                  <div className="mt-1 flex flex-wrap gap-x-4 text-xs">
                    {/* the registration endpoint already refuses these, so a PENDING row showing
                        them means the state changed after filing — the case where a human, not a
                        heuristic, should decide */}
                    {d.standing.houseAccounts > 0 && (
                      <span style={{ color: 'var(--admin-danger)' }} data-testid={`deal-house-${d.id}`}>
                        {t('affiliates.dealHouse', { count: d.standing.houseAccounts })}
                      </span>
                    )}
                    {d.standing.otherPartnerAccounts > 0 && (
                      <span style={{ color: 'var(--admin-danger)' }}>{t('affiliates.dealOtherPartnerAccounts', { count: d.standing.otherPartnerAccounts })}</span>
                    )}
                    <span style={{ color: d.standing.accounts > 0 ? 'var(--admin-warning, var(--admin-ink))' : 'var(--admin-ink-soft)' }}>
                      {t('affiliates.dealExisting', { count: d.standing.accounts })}
                    </span>
                    {d.affiliateEmailDomain === d.domain && (
                      <span style={{ color: 'var(--admin-danger)' }} data-testid={`deal-self-${d.id}`}>{t('affiliates.dealSelfDomain')}</span>
                    )}
                  </div>
                  {d.note !== null && d.note !== '' && <div className="mt-1 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{d.note}</div>}
                </div>
                <Badge tone={DEAL_TONE[d.status]} data-testid={`deal-status-${d.id}`}>{t(`affiliates.dealStatus.${d.status}`)}</Badge>
                {d.status === 'pending' && (
                  <>
                    <AdminButton size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ id: d.id, status: 'approved' })} data-testid={`deal-approve-${d.id}`}>
                      {t('affiliates.dealApprove')}
                    </AdminButton>
                    <AdminButton
                      size="sm"
                      variant="ghost"
                      disabled={decide.isPending}
                      onClick={() => {
                        // the reason is shown to the PARTNER, so it is asked for rather than left
                        // blank — a rejection with no explanation is the support ticket this avoids
                        const reason = window.prompt(t('affiliates.dealRejectReason'))
                        // CANCEL MEANS CANCEL. `?? ''` turned Escape into an irreversible rejection
                        // with no explanation — and a decided claim cannot be decided again.
                        if (reason === null) return
                        decide.mutate({ id: d.id, status: 'rejected', reason })
                      }}
                      data-testid={`deal-reject-${d.id}`}
                    >
                      {t('affiliates.dealReject')}
                    </AdminButton>
                  </>
                )}
                {d.expiresAt !== null && d.status !== 'rejected' && (
                  <span className="text-xs tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{t('affiliates.dealUntil', { date: dt(d.expiresAt) })}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {decide.isError && (
        <p role="alert" className="admin-hairline-t px-4 py-2 text-xs" style={{ color: 'var(--admin-danger)' }} data-testid="deal-error">
          {/* 409 is the only one that means what the conflict copy says. Showing it for a 404
              (already decided) or a 500 sends an admin looking for a rival claim that isn't there. */}
          {decide.error instanceof ApiError && decide.error.status === 409 ? t('affiliates.dealConflict') : t('affiliates.actionError')}
        </p>
      )}
    </div>
  )
}

/**
 * The numbers that make this a registry rather than a contact list: how many customers a partner
 * brought, how many are still producing, and what they are owed.
 *
 * `notPaying` is shown as its own figure and not folded into `customers`, because "12 referred" next
 * to "€0 owed" is the shape of a partner who is sending traffic that never converts — a different
 * conversation from one who converts and whose windows have closed.
 */
function PartnerStats({ affiliate }: { affiliate: AffiliateWithStats }) {
  const { t } = useTranslation()
  // `money` is the module-level formatter — the array gets a different name rather than shadowing it
  const { customers, notPaying, earning, money: byCurrency } = affiliate.stats
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 pb-3 text-xs" style={{ color: 'var(--admin-ink-soft)' }} data-testid={`affiliate-stats-${affiliate.id}`}>
      {/* `count`, not an arbitrary name: i18next selects the plural form off THAT option, and
          Lithuanian and Polish get "1 klientai"/"1 klientów" without it */}
      <span className="tabular-nums">{t('affiliates.stats.customers', { count: customers })}</span>
      <span className="tabular-nums">{t('affiliates.stats.earning', { count: earning })}</span>
      <span className="tabular-nums">{t('affiliates.stats.notPaying', { count: notPaying })}</span>
      {byCurrency.length === 0 ? (
        <span data-testid={`affiliate-money-none-${affiliate.id}`}>{t('affiliates.stats.nothingYet')}</span>
      ) : (
        byCurrency.map((m) => (
          <span key={m.currency} className="tabular-nums">
            {t('affiliates.stats.earned', { amount: money(m.earnedCents, m.currency) })}
            {' · '}
            {/* what a payout run works from — deliberately the last thing on the line so it reads as the action */}
            <strong style={{ color: m.pendingCents > 0 ? 'var(--admin-warning, var(--admin-ink))' : 'var(--admin-ink-soft)' }}>
              {t('affiliates.stats.pending', { amount: money(m.pendingCents, m.currency) })}
            </strong>
          </span>
        ))
      )}
    </div>
  )
}

/**
 * Edit a partner's terms after the invite.
 *
 * The invite form could set a percentage and a window; nothing could change them afterwards, so a
 * renegotiated deal meant a row in the database nobody could reach. Both fields are money controls,
 * so the panel states what a change does and does NOT do — see the note keys. It matters: an admin
 * raising the rate to fix an under-paid partner will expect the open commissions to follow, and they
 * will not (the rate is snapshotted per accrual, deliberately, so history is never re-priced).
 */
function EditPartner({ affiliate, onSaved }: { affiliate: AffiliateWithStats; onSaved: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(affiliate.name)
  const [pct, setPct] = useState(String(Number(affiliate.commissionPct)))
  const [months, setMonths] = useState(String(affiliate.commissionMonths))
  const [locale, setLocale] = useState(affiliate.locale)
  /**
   * What the row said WHEN THIS PANEL OPENED — the diff baseline.
   *
   * Diffing against the live `affiliate` prop looks equivalent and is not: the query has no
   * staleTime and refetches on window focus, so the row updates underneath an open sheet. Admin A
   * opens at 20%, admin B raises it to 30%, A's window refocuses, A fixes a typo in the name and
   * saves — and because the untouched input still reads 20 while the prop now reads 30, the patch
   * carries `commissionPct: 20` and silently reverts B's raise, with A's name on the audit row.
   */
  const [baseline, setBaseline] = useState(affiliate)

  const save = useMutation({
    mutationFn: () => {
      // the diff lives in lib/affiliates.ts and is unit-tested — see buildAffiliatePatch for why
      // both "diff against the baseline" and "skip an empty patch" are correctness, not tidiness
      const data = buildAffiliatePatch(baseline, { name, pct, months, locale })
      return data === null ? Promise.resolve(null) : updateAffiliate(affiliate.id, data)
    },
    onSuccess: () => {
      setOpen(false)
      onSaved()
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) {
          // re-seed from the row each time it opens, so a cancelled edit is not still sitting there,
          // and take a fresh baseline with it. `save.reset()` too: without it, one failed save left
          // the red error showing the next time the panel opened, before anyone had touched a field.
          setName(affiliate.name)
          setPct(String(Number(affiliate.commissionPct)))
          setMonths(String(affiliate.commissionMonths))
          setLocale(affiliate.locale)
          setBaseline(affiliate)
          save.reset()
        }
      }}
    >
      <SheetTrigger asChild>
        <AdminButton size="sm" variant="ghost" data-testid={`affiliate-edit-open-${affiliate.id}`}>
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          {t('affiliates.edit')}
        </AdminButton>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('affiliates.editTitle', { name: affiliate.name })}</SheetTitle>
        </SheetHeader>
        <form
          className="grid gap-4 p-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid gap-1.5">
            <AdminLabel htmlFor={`edit-name-${affiliate.id}`}>{t('affiliates.name')}</AdminLabel>
            <AdminInput id={`edit-name-${affiliate.id}`} value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} data-testid="affiliate-edit-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <AdminLabel htmlFor={`edit-pct-${affiliate.id}`}>{t('affiliates.pct')}</AdminLabel>
              <AdminInput id={`edit-pct-${affiliate.id}`} type="number" min={0} max={100} step={0.01} value={pct} onChange={(e) => setPct(e.target.value)} required data-testid="affiliate-edit-pct" />
            </div>
            <div className="grid gap-1.5">
              <AdminLabel htmlFor={`edit-months-${affiliate.id}`}>{t('affiliates.months')}</AdminLabel>
              <AdminInput id={`edit-months-${affiliate.id}`} type="number" min={1} max={120} step={1} value={months} onChange={(e) => setMonths(e.target.value)} required data-testid="affiliate-edit-months" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <AdminLabel htmlFor={`edit-locale-${affiliate.id}`}>{t('affiliates.locale')}</AdminLabel>
            {/* the language of the mail WE send THEM. A partner is not a tenant user, so there is no
                user row to read it from, and the referred customer's browser language is the wrong
                person's preference entirely. */}
            <select
              id={`edit-locale-${affiliate.id}`}
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="admin-input"
              data-testid="affiliate-edit-locale"
            >
              {(['en', 'lt', 'de', 'pl'] as const).map((l) => (
                <option key={l} value={l}>{t(`affiliates.localeName.${l}`)}</option>
              ))}
            </select>
          </div>
          <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }} data-testid="affiliate-edit-note">
            {t('affiliates.editNoteRate')}
          </p>
          <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
            {t('affiliates.editNoteWindow')}
          </p>
          {save.isError && (
            <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="affiliate-edit-error">{t('affiliates.actionError')}</p>
          )}
          <SheetFooter>
            <AdminButton type="button" variant="ghost" onClick={() => setOpen(false)}>{t('admin.cancel')}</AdminButton>
            <AdminButton type="submit" disabled={save.isPending} data-testid="affiliate-edit-save">{t('admin.save')}</AdminButton>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Mint the partner's one-time sign-in link.
 *
 * The plaintext token comes back ONCE (only its hash is stored), so it is rendered for copying and
 * never re-fetchable — pressing the button again mints a NEW link and invalidates the old one, which
 * is why the caption says so rather than leaving an admin to discover it by breaking a partner's
 * onboarding.
 */
function LoginLinkButton({ affiliate }: { affiliate: AffiliateView }) {
  const { t } = useTranslation()
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const issue = useMutation({ mutationFn: () => issuePartnerLoginLink(affiliate.id), onSuccess: setLink })
  // a failed mint used to replace the button's label PERMANENTLY — the row stays mounted, so the
  // error outlived the attempt and there was no way back to "Sign-in link" but a page reload
  const label = issue.isError ? t('affiliates.actionError') : t('affiliates.loginLink')

  if (link !== null) {
    return (
      <span className="flex min-w-0 items-center gap-2" data-testid={`affiliate-link-${affiliate.id}`}>
        <code className="mono truncate rounded-md border px-2 py-1 text-[11px]" style={{ maxWidth: '18rem', borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }}>{link}</code>
        <AdminButton
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(link)
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }}
          data-testid={`affiliate-link-copy-${affiliate.id}`}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
          {copied ? t('affiliates.copied') : t('affiliates.copy')}
        </AdminButton>
      </span>
    )
  }
  return (
    <AdminButton
      size="sm"
      variant="ghost"
      disabled={issue.isPending}
      onClick={() => {
        issue.reset()
        issue.mutate()
      }}
      data-testid={`affiliate-link-issue-${affiliate.id}`}
      title={t('affiliates.loginLinkHint')}
    >
      <KeyRound className="h-3.5 w-3.5" aria-hidden />
      {label}
    </AdminButton>
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
