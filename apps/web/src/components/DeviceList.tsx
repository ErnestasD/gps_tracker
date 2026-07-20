import { Search } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { StatusDot } from '@/components/ui-x/StatusDot'
import type { DeviceLive } from '@/lib/liveStore'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'

/**
 * Floating 320px live panel (spec §4 Live Map). No virtualizer: 500 memoized rows
 * re-render at most 1×/s and offscreen rows skip paint via content-visibility
 * (.device-row). Fallback if the founder-laptop check ever shows jank:
 * @tanstack/react-virtual — deliberately NOT added now (scope discipline).
 * Search filters on deviceId — names/groups arrive with E03-3 CRUD.
 */
export function DeviceList({
  devices,
  selectedId,
  onSelect,
  loading = false,
}: {
  devices: DeviceLive[]
  selectedId: string | null
  onSelect: (id: string) => void
  // true during the initial connect/seed so we show a loader instead of flashing "No devices yet"
  loading?: boolean
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  const shown = useMemo(
    () => (query === '' ? devices : devices.filter((d) => d.ev.deviceId.includes(query.trim()))),
    [devices, query],
  )

  return (
    <div
      data-testid="device-list"
      className="absolute bottom-4 left-4 top-4 z-10 flex w-80 flex-col overflow-hidden rounded-card border border-line bg-surface/95 shadow-card backdrop-blur"
    >
      <div className="border-b border-line p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            className="h-8 pl-8 text-sm"
            placeholder={t('deviceList.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('deviceList.search')}
          />
        </div>
        <div className="pt-1.5 text-[11px] text-muted">
          {t('deviceList.count', { shown: shown.length, total: devices.length })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto" role="listbox" aria-label={t('deviceList.title')}>
        {loading && devices.length === 0 ? (
          <p className="p-4 text-sm text-muted" data-testid="device-list-loading">{t('admin.loading')}</p>
        ) : devices.length === 0 ? (
          <p className="p-4 text-sm text-muted">{t('deviceList.empty')}</p>
        ) : shown.length === 0 ? (
          <p className="p-4 text-sm text-muted">{t('deviceList.noMatch')}</p>
        ) : (
          shown.map((d) => (
            <DeviceRow key={d.ev.deviceId} device={d} selected={d.ev.deviceId === selectedId} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  )
}

const DeviceRow = memo(function DeviceRow({
  device,
  selected,
  onSelect,
}: {
  device: DeviceLive
  selected: boolean
  onSelect: (id: string) => void
}) {
  const { speed } = useUnits()
  const { ev, status } = device
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-testid={`device-row-${ev.deviceId}`}
      onClick={() => onSelect(ev.deviceId)}
      className={cn(
        'device-row flex w-full items-center gap-2.5 border-b border-line/50 px-3 py-2.5 text-left hover:bg-surface-2',
        selected && 'bg-surface-2 shadow-[inset_2px_0_0_0_var(--accent-2)]',
      )}
    >
      <StatusDot status={status} />
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-text">{ev.deviceId}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted">{speed(ev.speed ?? 0)}</span>
    </button>
  )
})
