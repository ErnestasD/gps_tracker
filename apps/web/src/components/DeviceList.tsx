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
 * Rows show the device NAME (via nameOf, joined from the CRUD list); search matches it.
 */
export function DeviceList({
  devices,
  silent = [],
  selectedId,
  onSelect,
  nameOf,
  loading = false,
}: {
  devices: DeviceLive[]
  /**
   * Devices in the fleet that have NEVER reported a position.
   *
   * They cannot be plotted — there is no coordinate — but omitting them entirely was worse than
   * useless: a fleet of eight showed "3 of 3", so the counter silently redefined "total" as "total
   * that happen to have a fix", and the five that had never called in were invisible with no
   * explanation. That is exactly the moment an operator most needs an answer: a tracker was just
   * added and has not connected yet, and the question is whether the mistake is theirs or the
   * device's. Listing them, greyed and labelled, answers it; hiding them does not.
   */
  silent?: { id: string; name: string }[]
  selectedId: string | null
  onSelect: (id: string) => void
  // deviceId → human label (device name). Falls back to the id when the CRUD list hasn't loaded.
  nameOf?: (deviceId: string) => string
  // true during the initial connect/seed so we show a loader instead of flashing "No devices yet"
  loading?: boolean
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const label = (deviceId: string) => nameOf?.(deviceId) ?? deviceId

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q === '' ? devices : devices.filter((d) => label(d.ev.deviceId).toLowerCase().includes(q))
  }, [devices, query, nameOf])

  const shownSilent = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q === '' ? silent : silent.filter((d) => d.name.toLowerCase().includes(q))
  }, [silent, query])

  const total = devices.length + silent.length

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
          {t('deviceList.count', { shown: shown.length + shownSilent.length, total })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto" role="listbox" aria-label={t('deviceList.title')}>
        {loading && total === 0 ? (
          <p className="p-4 text-sm text-muted" data-testid="device-list-loading">{t('admin.loading')}</p>
        ) : total === 0 ? (
          <p className="p-4 text-sm text-muted">{t('deviceList.empty')}</p>
        ) : shown.length + shownSilent.length === 0 ? (
          <p className="p-4 text-sm text-muted">{t('deviceList.noMatch')}</p>
        ) : (
          <>
            {shown.map((d) => (
              <DeviceRow key={d.ev.deviceId} device={d} label={label(d.ev.deviceId)} selected={d.ev.deviceId === selectedId} onSelect={onSelect} />
            ))}
            {shownSilent.map((d) => (
              <SilentRow key={d.id} label={d.name} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

const DeviceRow = memo(function DeviceRow({
  device,
  label,
  selected,
  onSelect,
}: {
  device: DeviceLive
  // resolved device name (stable string → memo stays effective); falls back to the id upstream
  label: string
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
      <span className="min-w-0 flex-1 truncate text-xs text-text">{label}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted">{speed(ev.speed ?? 0)}</span>
    </button>
  )
})

/**
 * A device that exists in the fleet and has never reported a position.
 *
 * Not clickable: there is nothing to fly the map to. The label says WHY it is not on the map,
 * because "missing" and "has not called in yet" look identical from the outside and only one of
 * them is the operator's problem to solve.
 */
const SilentRow = memo(function SilentRow({ label }: { label: string }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid={`device-row-silent-${label}`}
      className="device-row flex w-full items-center gap-2.5 border-b border-line/50 px-3 py-2.5 text-left opacity-60"
    >
      <StatusDot status="offline" />
      <span className="min-w-0 flex-1 truncate text-xs text-text">{label}</span>
      <span className="shrink-0 text-[11px] text-muted">{t('deviceList.noFix')}</span>
    </div>
  )
})

