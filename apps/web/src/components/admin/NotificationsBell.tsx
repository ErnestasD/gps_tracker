import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { eventSeverity } from '@/lib/dashboard'
import { useFmt } from '@/lib/datetime'
import { listEvents, localizedEventSummary } from '@/lib/events'
import { markAllRead, markRead, readIds, unreadCount } from '@/lib/notifications'
import { useUnits } from '@/lib/units'

const SEVERITY_TONE = {
  critical: 'var(--admin-danger)',
  warning: 'var(--admin-warning)',
  info: 'var(--admin-brand)',
} as const

/**
 * Topbar notifications bell (ADR-028 round 2, from the design's AdminTopbar): the latest
 * REAL pipeline events with an unread badge. Read-state is device-local (lib/notifications —
 * localStorage), since events carry no per-user read flag server-side.
 */
export function NotificationsBell() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const u = useUnits()
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const [read, setRead] = React.useState<Set<string>>(() => readIds())

  const events = useQuery({ queryKey: ['bell-events'], queryFn: () => listEvents({ limit: 20 }), refetchInterval: 60_000 })
  const rows = events.data ?? []
  const unread = unreadCount(rows.map((e) => e.id), read)
  const recent = rows.slice(0, 8)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-surface-2"
          style={{ color: 'var(--admin-ink)' }}
          // aria-label WINS over descendant text in accname computation, so the unread count
          // must live inside it — the visual badge alone is invisible to screen readers
          aria-label={unread > 0 ? t('bell.titleUnread', { n: unread > 99 ? '99+' : unread }) : t('bell.title')}
          data-testid="bell"
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-none"
              style={{ background: 'var(--admin-danger)', color: '#fff' }}
              data-testid="bell-count"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="bell-popover">
        <div className="admin-hairline-b flex items-center justify-between px-3 py-2">
          <div className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
            {t('bell.title')}
          </div>
          <button
            type="button"
            onClick={() => setRead(markAllRead(read, rows.map((e) => e.id)))}
            className="inline-flex items-center gap-1 text-[11px] font-medium"
            style={{ color: 'var(--admin-brand)' }}
            data-testid="bell-mark-all"
          >
            <CheckCheck className="h-3 w-3" aria-hidden />
            {t('bell.markAll')}
          </button>
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {events.isError ? (
            <li role="alert" className="p-6 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="bell-error">
              {t('admin.loadError')}
            </li>
          ) : events.isLoading ? (
            <li className="p-6 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="bell-loading">
              {t('admin.loading')}
            </li>
          ) : recent.length === 0 && (
            <li className="p-6 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>
              {t('bell.empty')}
            </li>
          )}
          {recent.map((e) => {
            const isRead = read.has(e.id)
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setRead(markRead(read, e.id))}
                  className="admin-hairline-b flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
                  style={{ background: isRead ? 'transparent' : 'var(--admin-brand-soft)' }}
                  data-testid="bell-item"
                >
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SEVERITY_TONE[eventSeverity(e.kind)] }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" style={{ color: 'var(--admin-ink)', fontWeight: isRead ? 400 : 600 }}>
                      {localizedEventSummary(t, e, { fmtSpeed: u.speed, fmtVolume: u.volumeL })}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--admin-ink-soft)' }}>
                      {t(`events.k.${e.kind}`, e.kind)} · {dt(e.at)}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="admin-hairline-t p-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              void navigate({ to: '/app/events' })
            }}
            className="block w-full rounded-md px-3 py-2 text-center text-sm font-medium"
            style={{ background: 'var(--admin-brand-soft)', color: 'var(--admin-brand)' }}
            data-testid="bell-view-all"
          >
            {t('bell.viewAll')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
