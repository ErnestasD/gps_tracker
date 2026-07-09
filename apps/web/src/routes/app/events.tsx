import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listDevices } from '@/lib/devices'
import { EVENT_KINDS, eventSummary, listEvents, type EventRow } from '@/lib/events'

const PAGE = 50
const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

/** Badge tone per kind — safety-critical events read as danger. */
const TONE: Record<string, 'default' | 'warn' | 'danger' | 'outline'> = {
  panic: 'danger',
  power_cut: 'danger',
  overspeed: 'warn',
  low_battery: 'warn',
  device_offline: 'warn',
  geofence: 'default',
  ignition: 'outline',
  din_change: 'outline',
}

/** Events timeline (E05-6): the pipeline's rule/geofence output. Filter by kind, device,
 * and time range; expand a row for the raw payload. Cursor-paginated (newest first). */
export function EventsPage() {
  const { t } = useTranslation()
  const [kind, setKind] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  // datetime-local → ISO; an empty/partial value is dropped so it never bounds the query
  const iso = (v: string): string | undefined => {
    if (v === '') return undefined
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }

  const query = useInfiniteQuery({
    queryKey: ['events', kind, deviceId, from, to],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listEvents({
        limit: PAGE,
        ...(kind ? { kind } : {}),
        ...(deviceId ? { deviceId } : {}),
        ...(iso(from) ? { from: iso(from) } : {}),
        ...(iso(to) ? { to: iso(to) } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last: EventRow[]) => (last.length === PAGE ? last[last.length - 1]!.id : undefined),
  })

  const rows = (query.data?.pages ?? []).flat()
  const deviceName = (id: string): string => devices.data?.find((d) => d.id === id)?.name ?? id

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">{t('events.title')}</h1>

      <Card>
        <CardHeader className="flex-col items-stretch gap-3 space-y-0 sm:flex-row sm:items-center">
          <CardTitle className="text-base">{t('events.timeline')}</CardTitle>
          <div className="ml-auto flex flex-wrap gap-2">
            <select aria-label={t('events.kind')} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="events-kind" className="h-8 rounded-card border border-line bg-surface px-2 text-xs">
              <option value="">{t('events.allKinds')}</option>
              {EVENT_KINDS.map((k) => <option key={k} value={k}>{t(`events.k.${k}`)}</option>)}
            </select>
            <select aria-label={t('events.device')} value={deviceId} onChange={(e) => setDeviceId(e.target.value)} data-testid="events-device" className="h-8 rounded-card border border-line bg-surface px-2 text-xs">
              <option value="">{t('events.allDevices')}</option>
              {(devices.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input type="datetime-local" aria-label={t('events.from')} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="events-from" className="h-8 rounded-card border border-line bg-surface px-2 text-xs" />
            <input type="datetime-local" aria-label={t('events.to')} value={to} onChange={(e) => setTo(e.target.value)} data-testid="events-to" className="h-8 rounded-card border border-line bg-surface px-2 text-xs" />
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 && !query.isLoading ? (
            <p className="py-8 text-center text-sm text-muted" data-testid="events-empty">{t('events.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="events-table">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">{t('events.when')}</th>
                    <th className="py-2 pr-3 font-medium">{t('events.kind')}</th>
                    <th className="py-2 pr-3 font-medium">{t('events.device')}</th>
                    <th className="py-2 pr-3 font-medium">{t('events.detail')}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Fragment key={r.id}>
                      <tr className="border-b border-line/60" data-testid={`event-row-${r.id}`}>
                        <td className="py-2 pr-3 tabular-nums text-muted">{fmt.format(new Date(r.at))}</td>
                        <td className="py-2 pr-3"><Badge variant={TONE[r.kind] ?? 'default'}>{t(`events.k.${r.kind}`, r.kind)}</Badge></td>
                        <td className="py-2 pr-3">{deviceName(r.deviceId)}</td>
                        <td className="py-2 pr-3 text-muted">{eventSummary(r)}</td>
                        <td className="py-2 text-right">
                          <Button variant="ghost" size="sm" data-testid={`event-expand-${r.id}`} onClick={() => setOpen((o) => (o === r.id ? null : r.id))}>
                            {open === r.id ? t('events.hide') : t('events.details')}
                          </Button>
                        </td>
                      </tr>
                      {open === r.id && (
                        <tr data-testid={`event-detail-${r.id}`}>
                          <td colSpan={5} className="bg-surface-2 p-3">
                            <pre className="max-h-64 overflow-auto rounded-card border border-line bg-surface p-2 text-xs">{JSON.stringify(r.payload, null, 2)}</pre>
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
              <Button variant="secondary" size="sm" data-testid="events-more" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {t('events.loadMore')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
