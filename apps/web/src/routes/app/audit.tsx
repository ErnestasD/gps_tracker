import { useInfiniteQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, Badge, PageHeader } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { AUDIT_ACTIONS, AUDIT_ENTITIES, listAudit, type AuditRow } from '@/lib/audit'
import { useFmt } from '@/lib/datetime'

const PAGE = 50

const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)' }

/** Audit log (E03-6): tenant mutation trail, admin-only. Filter by entity/action,
 * expand a row to see the before/after snapshot (secrets already redacted server-side).
 * Re-skinned onto the admin design (ADR-028); the cursor-paginated table + load-more stays
 * (the design's client-side DataTable cannot page a server cursor). */
export function AuditPage() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const query = useInfiniteQuery({
    queryKey: ['audit', entity, action],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listAudit({ limit: PAGE, ...(entity ? { entity } : {}), ...(action ? { action } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (last: AuditRow[]) => (last.length === PAGE ? last[last.length - 1]!.id : undefined),
  })

  const rows = (query.data?.pages ?? []).flat()

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
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
                  <th className={th} style={thStyle}>{t('audit.entityId')}</th>
                  <th className={th} style={thStyle}>{t('audit.who')}</th>
                  <th className="px-4 py-2.5"><span className="sr-only">{t('audit.details')}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]" data-testid={`audit-row-${r.id}`}>
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{dt(r.at)}</td>
                      {/* destructive actions read as warnings (pre-redesign parity) */}
                      <td className="px-4 py-2.5"><Badge tone={r.action === 'delete' ? 'warning' : 'brand'}>{t(`audit.a.${r.action}`)}</Badge></td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--admin-ink)' }}>{t(`audit.e.${r.entity}`, r.entity)}</td>
                      <td className="mono px-4 py-2.5 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{r.entityId}</td>
                      <td className="mono px-4 py-2.5 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{r.userId?.slice(0, 8) ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <AdminButton variant="ghost" size="sm" data-testid={`audit-expand-${r.id}`} aria-expanded={open === r.id} onClick={() => setOpen((o) => (o === r.id ? null : r.id))}>
                          {open === r.id ? t('audit.hide') : t('audit.details')}
                        </AdminButton>
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr data-testid={`audit-detail-${r.id}`}>
                        <td colSpan={6} className="admin-hairline-b p-3" style={{ background: 'var(--admin-surface-sunken)' }}>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Snapshot label={t('audit.before')} value={r.before} />
                            <Snapshot label={t('audit.after')} value={r.after} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
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

function Snapshot({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="pb-1 text-xs font-medium" style={{ color: 'var(--admin-ink-soft)' }}>{label}</div>
      <pre
        className="mono max-h-64 overflow-auto rounded-md border p-2 text-xs"
        style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }}
      >
        {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
