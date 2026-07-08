import { useInfiniteQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AUDIT_ACTIONS, AUDIT_ENTITIES, listAudit, type AuditRow } from '@/lib/audit'

const PAGE = 50
const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

/** Audit log (E03-6): tenant mutation trail, admin-only. Filter by entity/action,
 * expand a row to see the before/after snapshot (secrets already redacted server-side). */
export function AuditPage() {
  const { t } = useTranslation()
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
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">{t('audit.title')}</h1>

      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <CardTitle className="text-base">{t('audit.trail')}</CardTitle>
          <div className="ml-auto flex gap-2">
            <select aria-label={t('audit.entity')} value={entity} onChange={(e) => setEntity(e.target.value)} data-testid="audit-entity" className="h-8 rounded-card border border-line bg-surface px-2 text-xs">
              <option value="">{t('audit.allEntities')}</option>
              {AUDIT_ENTITIES.map((e) => <option key={e} value={e}>{t(`audit.e.${e}`)}</option>)}
            </select>
            <select aria-label={t('audit.action')} value={action} onChange={(e) => setAction(e.target.value)} data-testid="audit-action" className="h-8 rounded-card border border-line bg-surface px-2 text-xs">
              <option value="">{t('audit.allActions')}</option>
              {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{t(`audit.a.${a}`)}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 && !query.isLoading ? (
            <p className="py-8 text-center text-sm text-muted">{t('audit.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="audit-table">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">{t('audit.when')}</th>
                    <th className="py-2 pr-3 font-medium">{t('audit.action')}</th>
                    <th className="py-2 pr-3 font-medium">{t('audit.entity')}</th>
                    <th className="py-2 pr-3 font-medium">{t('audit.entityId')}</th>
                    <th className="py-2 pr-3 font-medium">{t('audit.who')}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Fragment key={r.id}>
                      <tr className="border-b border-line/60" data-testid={`audit-row-${r.id}`}>
                        <td className="py-2 pr-3 tabular-nums text-muted">{fmt.format(new Date(r.at))}</td>
                        <td className="py-2 pr-3"><Badge variant={r.action === 'delete' ? 'warn' : 'default'}>{t(`audit.a.${r.action}`)}</Badge></td>
                        <td className="py-2 pr-3">{t(`audit.e.${r.entity}`, r.entity)}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-muted">{r.entityId}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-muted">{r.userId?.slice(0, 8) ?? '—'}</td>
                        <td className="py-2 text-right">
                          <Button variant="ghost" size="sm" data-testid={`audit-expand-${r.id}`} onClick={() => setOpen((o) => (o === r.id ? null : r.id))}>
                            {open === r.id ? t('audit.hide') : t('audit.details')}
                          </Button>
                        </td>
                      </tr>
                      {open === r.id && (
                        <tr data-testid={`audit-detail-${r.id}`}>
                          <td colSpan={6} className="bg-surface-2 p-3">
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
            <div className="pt-3 text-center">
              <Button variant="secondary" size="sm" data-testid="audit-more" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {t('audit.loadMore')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Snapshot({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="pb-1 text-xs font-medium text-muted">{label}</div>
      <pre className="max-h-64 overflow-auto rounded-card border border-line bg-surface p-2 text-xs">
        {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
