import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TENANT_PLANS, type TenantPlan } from '@orbetra/shared'

import { AdminButton, Badge, PageHeader } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { getCurrentUser } from '@/lib/auth'
import { useFmt } from '@/lib/datetime'
import { listTenants } from '@/lib/devices'
import {
  getTenant,
  listLeads,
  listTenantAccounts,
  listTenantDomains,
  platformAudit,
  restoreTenant,
  setTenantPlan,
} from '@/lib/platform'
import { monthStartUtc, platformUsage } from '@/lib/usage'

const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)' }
const td = 'px-4 py-2.5'

const TABS = ['tenants', 'leads', 'audit'] as const
type Tab = (typeof TABS)[number]

/**
 * Platform admin panel (E07-4, W7 S4; extended for operations).
 *
 * It used to be a list of tenants and their billable device-days, which meant every OTHER platform
 * question went through a database console: which plan a tenant is on and how to change it (the
 * upgrade the marketing site invites people to ask for), why a customer's fleet went dark and how to
 * put it back, who enquired through the public site, and what a platform admin did last week. Each
 * of those endpoints already existed. None had a screen.
 *
 * platform_admin only — the in-page gate mirrors quarantine; the server 403s everyone else.
 */
export function PlatformPage() {
  const { t } = useTranslation()
  const isPlatform = getCurrentUser()?.role === 'platform_admin'
  const [tab, setTab] = useState<Tab>('tenants')
  const [openTenant, setOpenTenant] = useState<string | null>(null)

  if (!isPlatform) {
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="platform-denied">
        {t('platform.denied')}
      </div>
    )
  }

  return (
    <div className="max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('platform.title')} description={t('platform.desc')} />

      <div className="admin-hairline-b flex gap-1" role="tablist" aria-label={t('platform.title')}>
        {TABS.map((id) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`platform-tab-${id}`}
              onClick={() => setTab(id)}
              className="-mb-px rounded-t-md px-3 py-2 text-sm font-medium transition-colors"
              style={{
                color: active ? 'var(--admin-brand)' : 'var(--admin-ink-soft)',
                background: active ? 'var(--admin-brand-soft)' : 'transparent',
                borderBottom: active ? '2px solid var(--admin-brand)' : '2px solid transparent',
              }}
            >
              {t(`platform.tab.${id}`)}
            </button>
          )
        })}
      </div>

      {tab === 'tenants' && (
        <>
          <TenantsTab onOpen={setOpenTenant} />
          {openTenant !== null && <TenantCard id={openTenant} onClose={() => setOpenTenant(null)} />}
        </>
      )}
      {tab === 'leads' && <LeadsTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}

function TenantsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation()
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: listTenants })
  const usage = useQuery({ queryKey: ['platform-usage'], queryFn: () => platformUsage(monthStartUtc()) })
  const usageByTenant = new Map((usage.data ?? []).map((u) => [u.tenantId, u]))
  const totalDays = (usage.data ?? []).reduce((s, u) => s + u.deviceDays, 0)
  // a failed usage fetch used to render as an authoritative "0 device-days" for every tenant —
  // show '—' + a banner instead so nobody reads billing usage as genuinely zero
  const usageErr = usage.isError

  // A failed /v1/tenants used to render as "this platform has no tenants" — under a footer stating
  // an authoritative device-day total. There is no state in which that is a truthful screen, and the
  // comment two lines above says exactly why for the usage half (review MED).
  if (tenants.isError) return <p role="alert" className="admin-card p-4 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="platform-error">{t('platform.usageError')}</p>
  if (tenants.isLoading) return <p className="admin-card p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="platform-loading">{t('platform.title')}…</p>
  if ((tenants.data ?? []).length === 0) return <p className="admin-card p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="platform-empty">{t('platform.empty')}</p>

  return (
    <div className="admin-card overflow-hidden">
      {usageErr && (
        <p role="alert" className="admin-hairline-b px-4 py-2 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="platform-usage-error">
          {t('platform.usageError')}
        </p>
      )}
      <table className="w-full text-sm">
        <thead className="admin-hairline-b">
          <tr>
            <th className={th} style={thStyle}>{t('platform.tenant')}</th>
            <th className={th} style={thStyle}>{t('platform.plan')}</th>
            <th className={th} style={thStyle}>{t('platform.state')}</th>
            <th className={th} style={thStyle}>{t('platform.deviceDays')}</th>
            <th className={th} style={thStyle}>{t('platform.activeDevices')}</th>
          </tr>
        </thead>
        <tbody>
          {(tenants.data ?? []).map((tn) => {
            const u = usageByTenant.get(tn.id)
            const row = tn as { id: string; name: string; plan?: string; suspendedAt?: string | null }
            return (
              <tr key={tn.id} className="admin-hairline-b" data-testid={`platform-tenant-${tn.id}`}>
                {/* a button, not a clickable <tr>: the card was unreachable by keyboard entirely */}
                <td className={td}>
                  <button type="button" className="underline-offset-2 hover:underline" style={{ color: 'var(--admin-ink)' }} onClick={() => onOpen(tn.id)}>
                    {tn.name}
                  </button>
                </td>
                <td className={td}><span className="mono text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{row.plan ?? '—'}</span></td>
                <td className={td}>
                  {row.suspendedAt != null
                    ? <Badge tone="danger">{t('platform.suspended')}</Badge>
                    : <Badge tone="neutral">{t('platform.active')}</Badge>}
                </td>
                <td className={`${td} tabular-nums`} style={{ color: 'var(--admin-ink)' }}>{usageErr ? '—' : (u?.deviceDays ?? 0)}</td>
                <td className={`${td} tabular-nums`} style={{ color: 'var(--admin-ink)' }}>{usageErr ? '—' : (u?.activeDevices ?? 0)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${td} text-sm font-semibold`} colSpan={3} style={{ color: 'var(--admin-ink-soft)' }}>{t('platform.total')}</td>
            <td className={`${td} font-semibold tabular-nums`} style={{ color: 'var(--admin-ink)' }}>
              <span data-testid="platform-total">{usageErr ? '—' : totalDays}</span>
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/**
 * One tenant, everything support is asked about: the plan, whether the fleet is cut off and how to
 * put it back, the accounts, and the white-label hosts their customers log in at.
 */
function TenantCard({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fmt = useFmt()
  const tenant = useQuery({ queryKey: ['platform-tenant', id], queryFn: () => getTenant(id) })
  const accounts = useQuery({ queryKey: ['platform-tenant-accounts', id], queryFn: () => listTenantAccounts(id) })
  const domains = useQuery({ queryKey: ['platform-tenant-domains', id], queryFn: () => listTenantDomains(id) })
  const [busy, setBusy] = useState(false)
  const [pendingPlan, setPendingPlan] = useState<TenantPlan | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['platform-tenant', id] })
    void qc.invalidateQueries({ queryKey: ['tenants'] })
  }
  const run = (fn: () => Promise<unknown>, okKey: string) => {
    setBusy(true)
    setMsg(null)
    fn()
      .then(() => { setMsg({ kind: 'ok', text: t(okKey) }); refresh() })
      .catch(() => setMsg({ kind: 'err', text: t('platform.actionError') }))
      .finally(() => setBusy(false))
  }

  const d = tenant.data
  // narrowed to a string so the badge needs no non-null assertions: `suspendedAt` IS the state
  const suspendedAt = d?.suspendedAt ?? null
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span style={{ color: 'var(--admin-ink-soft)' }}>{label}</span>
      <span style={{ color: 'var(--admin-ink)' }}>{value}</span>
    </div>
  )

  return (
    <div className="admin-card space-y-4 p-4" data-testid="platform-tenant-card">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{d?.name ?? '…'}</div>
        <AdminButton variant="ghost" size="sm" onClick={onClose} data-testid="platform-tenant-close">{t('platform.close')}</AdminButton>
      </div>

      <div className="text-sm">
        {row(t('platform.tenantId'), <span className="mono text-xs">{id}</span>)}
        {row(t('platform.subscription'), d?.subscriptionStatus ?? '—')}
        {row(t('platform.periodEnd'), d?.currentPeriodEnd != null ? fmt.dt(d.currentPeriodEnd) : '—')}
        {/* the ladder position, so "why did my fleet stop" has an answer on screen: 0 = no notice
            sent, 3 = the final warning went out and suspension follows */}
        {row(t('platform.noticeStage'), String(d?.lapseNoticeStage ?? 0))}
      </div>

      <div className="admin-hairline-t space-y-2 pt-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span style={{ color: 'var(--admin-ink-soft)' }}>{t('platform.plan')}</span>
          <div className="w-56">
            <Combobox
              data-testid="platform-plan-select"
              aria-label={t('platform.plan')}
              value={d?.plan ?? ''}
              // a plan change is one click on somebody else's live business — confirm it, with the
              // counts that make a downgrade's consequence concrete
              onChange={(v) => setPendingPlan(v as TenantPlan)}
              disabled={busy}
              options={TENANT_PLANS.map((p) => ({ value: p, label: p }))}
            />
          </div>
        </div>
        {/* a plan field that silently means two things is how someone ends up served for free */}
        <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('platform.planNote')}</p>
      </div>

      <div className="admin-hairline-t space-y-2 pt-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span style={{ color: 'var(--admin-ink-soft)' }}>{t('platform.state')}</span>
          {suspendedAt !== null ? <Badge tone="danger">{t('platform.suspendedSince', { at: fmt.dt(suspendedAt) })}</Badge> : <Badge tone="neutral">{t('platform.active')}</Badge>}
        </div>
        {suspendedAt !== null && (
          <>
            <AdminButton type="button" disabled={busy} onClick={() => run(() => restoreTenant(id), 'platform.restored')} data-testid="platform-restore">
              {t('platform.restore')}
            </AdminButton>
            <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('platform.restoreNote')}</p>
          </>
        )}
      </div>

      <div className="admin-hairline-t pt-3 text-sm">
        <div className="mb-1" style={{ color: 'var(--admin-ink-soft)' }}>{t('platform.domains')}</div>
        {(domains.data ?? []).length === 0
          ? <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('platform.noDomains')}</p>
          : (domains.data ?? []).map((dom) => (
              <div key={dom.id} className="flex items-center justify-between py-1">
                <span className="mono text-xs" style={{ color: 'var(--admin-ink)' }}>{dom.domain}</span>
                <Badge tone={dom.verified ? 'neutral' : 'warning'}>{dom.verified ? t('branding.verified') : t('branding.pending')}</Badge>
              </div>
            ))}
      </div>

      <div className="admin-hairline-t pt-3 text-sm">
        <div className="mb-1" style={{ color: 'var(--admin-ink-soft)' }}>{t('platform.accounts')}</div>
        {(accounts.data ?? []).map((a) => (
          <div key={a.id} className="py-1" style={{ color: 'var(--admin-ink)' }}>{a.name} <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>· {a.timezone ?? 'UTC'}</span></div>
        ))}
      </div>

      <ConfirmDialog
        open={pendingPlan !== null}
        onOpenChange={(o) => { if (!o) setPendingPlan(null) }}
        title={t('platform.planConfirmTitle')}
        description={t('platform.planConfirm', { plan: pendingPlan ?? '', accounts: (accounts.data ?? []).length, domains: (domains.data ?? []).length })}
        confirmLabel={t('platform.planSave')}
        onConfirm={() => {
          const next = pendingPlan
          setPendingPlan(null)
          if (next !== null) run(() => setTenantPlan(id, next), 'platform.planSaved')
        }}
      />

      {msg !== null && (
        <p role="status" className="text-sm" style={{ color: msg.kind === 'ok' ? 'var(--admin-ink-soft)' : 'var(--admin-danger)' }} data-testid="platform-tenant-msg">
          {msg.text}
        </p>
      )}
    </div>
  )
}

/** Pilot enquiries from the public site. They have been landing in a table nobody could read. */
function LeadsTab() {
  const { t } = useTranslation()
  const fmt = useFmt()
  const leads = useQuery({ queryKey: ['platform-leads'], queryFn: listLeads })
  const rows = leads.data ?? []
  if (leads.isError) return <p role="alert" className="admin-card p-4 text-sm" style={{ color: 'var(--admin-danger)' }}>{t('platform.actionError')}</p>
  if (rows.length === 0) return <p className="admin-card p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="platform-no-leads">{t('platform.noLeads')}</p>
  return (
    <div className="admin-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="admin-hairline-b">
          <tr>
            <th className={th} style={thStyle}>{t('platform.when')}</th>
            <th className={th} style={thStyle}>{t('platform.leadName')}</th>
            <th className={th} style={thStyle}>{t('platform.leadCompany')}</th>
            <th className={th} style={thStyle}>{t('platform.leadContact')}</th>
            <th className={th} style={thStyle}>{t('platform.leadDevices')}</th>
            <th className={th} style={thStyle}>{t('platform.leadMessage')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} className="admin-hairline-b" data-testid={`platform-lead-${l.id}`}>
              <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>{fmt.dt(l.createdAt)}</td>
              <td className={td} style={{ color: 'var(--admin-ink)' }}>{l.name}</td>
              <td className={td} style={{ color: 'var(--admin-ink)' }}>{l.company}</td>
              <td className={td}>
                <a href={`mailto:${l.email}`} className="underline-offset-2 hover:underline" style={{ color: 'var(--admin-brand)' }}>{l.email}</a>
                {l.phone != null && <span className="ml-2 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{l.phone}</span>}
              </td>
              <td className={td} style={{ color: 'var(--admin-ink)' }}>{l.deviceCount ?? '—'}</td>
              <td className={`${td} max-w-md`} style={{ color: 'var(--admin-ink-soft)' }}>{l.message ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The platform trail: partner terms, commission decisions, and now hand-restored fleets. */
function AuditTab() {
  const { t } = useTranslation()
  const fmt = useFmt()
  const entries = useQuery({ queryKey: ['platform-audit'], queryFn: () => platformAudit(100) })
  const rows = entries.data ?? []
  if (entries.isError) return <p role="alert" className="admin-card p-4 text-sm" style={{ color: 'var(--admin-danger)' }}>{t('platform.actionError')}</p>
  if (rows.length === 0) return <p className="admin-card p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="platform-no-audit">{t('audit.empty')}</p>
  return (
    <div className="admin-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="admin-hairline-b">
          <tr>
            <th className={th} style={thStyle}>{t('platform.when')}</th>
            <th className={th} style={thStyle}>{t('audit.action')}</th>
            <th className={th} style={thStyle}>{t('audit.entity')}</th>
            <th className={th} style={thStyle}>{t('audit.entityId')}</th>
            <th className={th} style={thStyle}>{t('audit.who')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="admin-hairline-b">
              <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>{fmt.dt(e.at)}</td>
              <td className={td} style={{ color: 'var(--admin-ink)' }}>{t(`audit.a.${e.action}`, e.action)}</td>
              <td className={td} style={{ color: 'var(--admin-ink)' }}>{t(`audit.e.${e.entity}`, e.entity)}</td>
              <td className={td}><span className="mono text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{e.entityId}</span></td>
              <td className={td}><span className="mono text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{e.userId ?? '—'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
