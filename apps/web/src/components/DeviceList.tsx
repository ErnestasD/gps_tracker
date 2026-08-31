import { ChevronRight, Gauge, Power, Satellite, Search } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { StatusDot } from '@/components/ui-x/StatusDot'
import { filterFleet, fleetPanelCounts, sortFleet, type FleetFilter, type FleetSort } from '@/lib/fleetFilter'
import type { DeviceLive } from '@/lib/liveStore'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'

/**
 * The fleet panel — a DOCKED column in the map workspace (founder design 2026-08-18).
 *
 * It used to float over the map as a 320px card. Two overlaying cards took most of a laptop screen,
 * and the thing an operator came to look at was underneath them; the workspace shell now gives this
 * its own column and the map keeps what is left. Sizing and position belong to the shell, so this
 * only fills the space it is given.
 * No virtualizer: 500 memoized rows
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
  detailOf,
  filter,
  follow,
  onFollow,
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
  /**
   * Per-device detail an operator recognises a vehicle by. Every field is optional and omitted when
   * absent: a row must never imply a plate or a driver the fleet has not recorded.
   */
  detailOf?: (deviceId: string) => { plate?: string | null; driver?: string | null } | undefined
  /**
   * The status filter, owned by the workspace.
   *
   * Lifted out of this component because the toolbar shows the same four counters on a wide screen:
   * two independent copies of "which statuses am I looking at" is how a chip ends up highlighted
   * next to a list that is not filtered.
   */
  filter: FleetFilter
  /** Camera-follows-selection, the same store flag the inspector's button drives. */
  follow: boolean
  onFollow: (v: boolean) => void
  // true during the initial connect/seed so we show a loader instead of flashing "No devices yet"
  loading?: boolean
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<FleetSort>('status')
  const label = (deviceId: string) => nameOf?.(deviceId) ?? deviceId

  const counts = useMemo(() => fleetPanelCounts(devices, silent), [devices, silent])
  const { shown, shownSilent } = useMemo(() => {
    const r = filterFleet(devices, silent, { query, filter, label })
    return { shown: sortFleet(r.devices, sort, label), shownSilent: r.silent }
  }, [devices, silent, query, filter, sort, nameOf])

  const total = counts.total

  return (
    <div data-testid="device-list" className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
        {/* The status filter used to live HERE TOO, identical to the toolbar's copy — two controls
            for one piece of state, both visible at once on a wide screen. It moved to the toolbar
            alone because the filter now governs the MAP as well as this list, and a control that
            hides with a collapsible panel would leave the map filtered by something the operator
            can no longer see or clear. The counts it carried went with it. */}
        <div className="flex items-center justify-between pt-1.5">
          <span className="text-[11px] text-muted">
            {t('deviceList.count', { shown: shown.length + shownSilent.length, total })}
          </span>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => onFollow(e.currentTarget.checked)}
              data-testid="fleet-follow"
              className="h-3.5 w-3.5 accent-[var(--admin-brand)]"
            />
            {t('info.follow')}
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.currentTarget.value as FleetSort)}
            aria-label={t('deviceList.sort.label')}
            data-testid="fleet-sort"
            className="rounded border border-line bg-transparent px-1 py-0.5 text-[11px] text-muted"
          >
            <option value="status">{t('deviceList.sort.status')}</option>
            <option value="name">{t('deviceList.sort.name')}</option>
            <option value="speed">{t('deviceList.sort.speed')}</option>
          </select>
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
              <DeviceRow
                key={d.ev.deviceId}
                device={d}
                label={label(d.ev.deviceId)}
                detail={detailOf?.(d.ev.deviceId)}
                selected={d.ev.deviceId === selectedId}
                onSelect={onSelect}
              />
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
  detail,
  selected,
  onSelect,
}: {
  device: DeviceLive
  // resolved device name (stable string → memo stays effective); falls back to the id upstream
  label: string
  detail?: { plate?: string | null; driver?: string | null } | undefined
  selected: boolean
  onSelect: (id: string) => void
}) {
  const { speed } = useUnits()
  const { ev, status } = device
  /**
   * Two lines, because one was not enough to recognise a vehicle by.
   *
   * A dispatcher looking for a truck knows its plate and its driver, not its device name — the
   * second line carries whatever the fleet has actually recorded and nothing else. An absent plate
   * is simply absent; inventing a placeholder there would be a claim about the customer's records.
   */
  const sub = [detail?.plate, detail?.driver].filter((x): x is string => typeof x === 'string' && x !== '')
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-testid={`device-row-${ev.deviceId}`}
      onClick={() => onSelect(ev.deviceId)}
      className={cn(
        'device-row flex w-full items-start gap-2.5 border-b border-line/50 px-3 py-2.5 text-left hover:bg-surface-2',
        selected && 'bg-surface-2 shadow-[inset_2px_0_0_0_var(--accent-2)]',
      )}
    >
      <StatusDot status={status} className="mt-1" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-text">{label}</span>
        {sub.length > 0 && <span className="block truncate text-[11px] text-muted">{sub.join(' · ')}</span>}
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
          <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
            <Gauge className="h-3 w-3" aria-hidden />
            {/* null ⇒ the model does not report speed; "0" would read as "parked" */}
            {ev.speed === null ? '—' : speed(ev.speed)}
          </span>
          {ev.satellites > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
              <Satellite className="h-3 w-3" aria-hidden />
              {ev.satellites}
            </span>
          )}
          {/* ignition is null when the model does not report it — three states, not two */}
          {ev.ignition !== null && (
            <span className="inline-flex shrink-0 items-center gap-1">
              <Power className={cn('h-3 w-3', ev.ignition && 'text-success')} aria-hidden />
            </span>
          )}
        </span>
      </span>
      <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
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

