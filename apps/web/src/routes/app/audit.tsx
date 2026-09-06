import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, Badge, PageHeader } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { listUsers } from '@/lib/accounts'
import { AUDIT_ACTIONS, AUDIT_ENTITIES, listAudit, type AuditRow } from '@/lib/audit'
import {
  auditChanges, auditSubjectLabel, fieldLabel, formatAuditValue, isColorValue, shortId,
  type AuditChange, type FormatCtx,
} from '@/lib/auditView'
import { useFmt } from '@/lib/datetime'
import { listAccounts, listDevices, listProfiles } from '@/lib/devices'
import { listDrivers } from '@/lib/drivers'

const PAGE = 50
/** Names change far more slowly than the trail is read; one fetch per visit is plenty. */
const NAMES_STALE_MS = 5 * 60_000

const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)' }

/**
 * The id → name lookup the trail needs to be readable.
 *
 * Every one of these lists is already cached under the same query key by another page (fleet,
 * accounts, drivers, the reseller dashboard), so arriving here usually costs nothing. A list that
 * fails or is still loading degrades to a short id — never to a blank cell, and never to a guess.
 */
function useAuditNames(): Map<string, string> {
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers, staleTime: NAMES_STALE_MS })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts, staleTime: NAMES_STALE_MS })
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices, staleTime: NAMES_STALE_MS })
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: listDrivers, staleTime: NAMES_STALE_MS })
  // global reference data, readable by every authenticated role — turns a device row's `profileId`
  // from a UUID into the model the operator ordered ("FMB920")
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: listProfiles, staleTime: NAMES_STALE_MS })
  return useMemo(() => {
    const names = new Map<string, string>()
    for (const a of accounts.data ?? []) names.set(a.id, a.name)
    for (const d of devices.data ?? []) names.set(d.id, d.name)
    for (const d of drivers.data ?? []) names.set(d.id, d.name)
    for (const p of profiles.data ?? []) names.set(p.id, p.name)
    for (const u of users.data ?? []) names.set(u.id, u.email)
    return names
  }, [accounts.data, devices.data, drivers.data, profiles.data, users.data])
}

/**
 * Audit log (E03-6): tenant mutation trail, admin-only. Filter by entity/action, expand a row to
 * see WHAT changed — field by field, in the reader's language, with ids resolved to names.
 *
 * It used to print the two raw snapshots as JSON side by side. That is an accurate record and an
 * unusable one: a branding change showed thirty lines of tenant record (Stripe ids included) with
 * one line different between the panes, and every id — the subject's, the actor's — was a bare
 * UUID. The diff, the names and the labels all live in `lib/auditView.ts`; this file is the table.
 */
export function AuditPage() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const names = useAuditNames()

  const query = useInfiniteQuery({
    queryKey: ['audit', entity, action],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listAudit({ limit: PAGE, ...(entity ? { entity } : {}), ...(action ? { action } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (last: AuditRow[]) => (last.length === PAGE ? last[last.length - 1]!.id : undefined),
  })

  const rows = query.data?.pages.flat() ?? []
  const ctx: FormatCtx = useMemo(
    () => ({ t: (key, fallback) => t(key, fallback), dt, resolveId: (id) => names.get(id) ?? null }),
    [t, dt, names],
  )

  /** The actor. `null` is honest — a Stripe webhook and the lapse worker act with nobody behind them.
   *  An id we cannot resolve (a platform admin, a user since deleted) keeps its full value in the
   *  title, so support can still trace it. */
  const actor = (userId: string | null): React.ReactNode => {
    if (userId === null) return t('audit.system')
    const name = names.get(userId)
    return name ?? <span title={userId}>{t('audit.unknownUser')} · {shortId(userId)}</span>
  }

  return (
    <div className="w-full space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('audit.title')} description={t('audit.desc')}>
        <div className="w-44">
          <Combobox aria-label={t('audit.entity')} value={entity} onChange={setEntity} data-testid="audit-entity"
            options={[{ value: '', label: t('audit.allEntities') }, ...AUDIT_ENTITIES.map((e) => ({ value: e, label: t(`audit.e.${e}`) }))]} />
        </div>
        <div className="w-44">
          <Combobox aria-label={t('audit.action')} value={action} onChange={setAction} data-testid="audit-action"
            options={[{ value: '', label: t('audit.allActions') }, ...AUDIT_ACTIONS.map((a) => ({ value: a, label: t(`audit.a.${a}`) }))]} />
        </div>
      </PageHeader>

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('audit.trail')}
        </div>
        {query.isError ? (
          <p role="alert" className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="audit-error">{t('admin.loadError')}</p>
        ) : query.isLoading ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="audit-loading">{t('admin.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('audit.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="audit-table">
              <thead>
                <tr style={{ background: 'var(--admin-surface-sunken)' }}>
                  <th className={th} style={thStyle}>{t('audit.when')}</th>
                  <th className={th} style={thStyle}>{t('audit.action')}</th>
                  <th className={th} style={thStyle}>{t('audit.entity')}</th>
                  <th className={th} style={thStyle}>{t('audit.changed')}</th>
                  <th className={th} style={thStyle}>{t('audit.who')}</th>
                  <th className="px-4 py-2.5"><span className="sr-only">{t('audit.details')}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const changes = auditChanges(r)
                  const subject = auditSubjectLabel(r, ctx)
                  return (
                    <Fragment key={r.id}>
                      <tr className="admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]" data-testid={`audit-row-${r.id}`}>
                        <td className="px-4 py-2.5 tabular-nums align-top" style={{ color: 'var(--admin-ink-soft)' }}>{dt(r.at)}</td>
                        {/* destructive actions read as warnings (pre-redesign parity) */}
                        <td className="px-4 py-2.5 align-top"><Badge tone={r.action === 'delete' ? 'warning' : 'brand'}>{t(`audit.a.${r.action}`)}</Badge></td>
                        <td className="px-4 py-2.5 align-top">
                          <div style={{ color: 'var(--admin-ink)' }}>{t(`audit.e.${r.entity}`, r.entity)}</div>
                          <div className="max-w-[22rem] truncate text-xs" style={{ color: 'var(--admin-ink-soft)' }} title={subject}>{subject}</div>
                        </td>
                        <td className="max-w-[20rem] px-4 py-2.5 align-top text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                          {changeSummary(changes, ctx, r.entity)}
                        </td>
                        <td className="px-4 py-2.5 align-top text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{actor(r.userId)}</td>
                        <td className="px-4 py-2.5 text-right align-top">
                          <AdminButton variant="ghost" size="sm" data-testid={`audit-expand-${r.id}`} aria-expanded={open === r.id} onClick={() => setOpen((o) => (o === r.id ? null : r.id))}>
                            {open === r.id ? t('audit.hide') : t('audit.details')}
                          </AdminButton>
                        </td>
                      </tr>
                      {open === r.id && (
                        <tr data-testid={`audit-detail-${r.id}`}>
                          <td colSpan={6} className="admin-hairline-b p-3" style={{ background: 'var(--admin-surface-sunken)' }}>
                            <ChangeTable row={r} changes={changes} ctx={ctx} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {query.hasNextPage && (
          <div className="admin-hairline-t p-3 text-center">
            <AdminButton variant="secondary" size="sm" data-testid="audit-more" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {t('audit.loadMore')}
            </AdminButton>
          </div>
        )}
      </div>
    </div>
  )
}

/** "Logo, Accent colour +2" — enough to recognise the row without expanding it. */
function changeSummary(changes: AuditChange[], ctx: FormatCtx, entity: string): string {
  if (changes.length === 0) return '—'
  const shown = changes.slice(0, 3).map((c) => fieldLabel(ctx.t, c.path, entity)).join(', ')
  return changes.length > 3 ? `${shown} +${changes.length - 3}` : shown
}

const cell = 'px-3 py-1.5 align-top'

/**
 * The expanded row: one line per field that changed.
 *
 * `update` shows before → after; `create`/`delete` have only one snapshot, so a single value
 * column is the honest layout — a "Before" column full of dashes suggests fields were cleared.
 * The technical id stays at the bottom: support needs it, the operator does not read it.
 */
function ChangeTable({ row, changes, ctx }: { row: AuditRow; changes: AuditChange[]; ctx: FormatCtx }) {
  const { t } = useTranslation()
  const isUpdate = row.before !== null && row.before !== undefined && row.after !== null && row.after !== undefined
  return (
    <div className="space-y-2">
      {changes.length === 0 ? (
        <p className="px-1 py-2 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('audit.noChanges')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border" style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="admin-hairline-b">
                <th className={`${cell} w-1/4 text-left text-[11px] font-semibold uppercase tracking-wider`} style={thStyle}>{t('audit.field')}</th>
                {isUpdate ? (
                  <>
                    <th className={`${cell} text-left text-[11px] font-semibold uppercase tracking-wider`} style={thStyle}>{t('audit.before')}</th>
                    <th className={`${cell} text-left text-[11px] font-semibold uppercase tracking-wider`} style={thStyle}>{t('audit.after')}</th>
                  </>
                ) : (
                  <th className={`${cell} text-left text-[11px] font-semibold uppercase tracking-wider`} style={thStyle}>{t('audit.value')}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.path} className="admin-hairline-b last:border-b-0">
                  <td className={cell} style={{ color: 'var(--admin-ink-soft)' }}>{fieldLabel(ctx.t, c.path, row.entity)}</td>
                  {isUpdate ? (
                    <>
                      <ValueCell value={c.before} path={c.path} entity={row.entity} ctx={ctx} muted />
                      <ValueCell value={c.after} path={c.path} entity={row.entity} ctx={ctx} />
                    </>
                  ) : (
                    <ValueCell value={c.after ?? c.before} path={c.path} entity={row.entity} ctx={ctx} />
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-1 text-[11px]" style={{ color: 'var(--admin-ink-soft)' }}>
        {t('audit.entityId')}: <span className="mono">{row.entityId}</span>
      </p>
    </div>
  )
}

/** A command response or a pasted note can run to kilobytes; the cell shows the head and keeps the
 *  whole value in the title attribute rather than turning one row into a wall. */
const MAX_CELL_CHARS = 400

/** Long values wrap rather than stretch the table; a colour also shows the colour. */
function ValueCell({ value, path, entity, ctx, muted = false }: { value: unknown; path: string; entity: string; ctx: FormatCtx; muted?: boolean }) {
  const text = formatAuditValue(value, path, entity, ctx)
  const long = text.length > MAX_CELL_CHARS
  return (
    <td className={cell} style={{ color: muted ? 'var(--admin-ink-soft)' : 'var(--admin-ink)' }}>
      <span className="flex items-start gap-1.5">
        {isColorValue(value) && (
          <span className="mt-[3px] inline-block h-3 w-3 shrink-0 rounded-sm border" style={{ background: value, borderColor: 'var(--admin-hairline)' }} />
        )}
        <span className="break-all" {...(long ? { title: text } : {})}>{long ? `${text.slice(0, MAX_CELL_CHARS)}…` : text}</span>
      </span>
    </td>
  )
}
