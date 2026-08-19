import { Activity, Radio, SlidersHorizontal, Terminal, X } from 'lucide-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusDot } from '@/components/ui-x/StatusDot'
import type { Device } from '@/lib/devices'
import type { DeviceLive } from '@/lib/liveStore'
import { cn } from '@/lib/utils'
import { useFmt } from '@/lib/datetime'
import { getTelemetry, hasTelemetry, telemetryRows } from '@/lib/telemetry'
import { CommandsCard } from '@/routes/app/devices/commands'
import { SettingsCard } from '@/routes/app/devices/settings'

import { InfoCard } from './InfoCard'

/**
 * The selected device's workspace on the map (ADR-028 admin idiom, founder design 2026-08-18).
 *
 * The map is meant to be where an operator lives, and until now selecting a vehicle told them its
 * speed and nothing else — every action was on another page, behind a table. This brings the
 * per-device panels that already exist to the vehicle they are about, so "why is that truck
 * reporting so rarely" and the slider that fixes it are one click apart instead of two navigations.
 *
 * The tabs host the SAME components the devices table opens, deliberately: a second implementation
 * of the command console or the settings sliders would be a second set of bugs, and the settings
 * card in particular carries hard-won rules about never showing a value the device has not
 * confirmed.
 *
 * A tab whose data needs a `Device` (not just a live position) is only offered when the registry row
 * is available — a device streaming positions we have no CRUD record for can still be watched, but
 * cannot be commanded.
 */
export type InspectorTab = 'overview' | 'params' | 'commands' | 'settings'

export function Inspector({
  live,
  device,
  name,
  follow,
  trail,
  canWrite,
  onFollow,
  onTrail,
  onClose,
}: {
  live: DeviceLive
  /** The registry row, when we have it. Absent ⇒ only the overview is meaningful. */
  device: Device | undefined
  name?: string
  follow: boolean
  trail: boolean
  canWrite: boolean
  onFollow: (v: boolean) => void
  onTrail: (v: boolean) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<InspectorTab>('overview')
  // selecting another vehicle returns to its position, rather than dropping the operator into a
  // terminal for a device they have not looked at yet
  const [lastId, setLastId] = useState(live.ev.deviceId)
  if (lastId !== live.ev.deviceId) {
    setLastId(live.ev.deviceId)
    setTab('overview')
  }

  /**
   * Commands and settings are WRITES, and the devices table gates them on `canWrite` for a stated
   * reason: a viewer's click 403s. Offering them here anyway would have put the Codec-12 console —
   * `cpureset`, `deleterecords` — one click from the landing page for a role the server refuses,
   * with a bare "could not send" as the only feedback. Authorization held; the gate did not.
   */
  const tabs: { id: InspectorTab; label: string; icon: typeof Activity }[] = [
    { id: 'overview', label: t('map.inspector.overview'), icon: Activity },
    // Parameters are a READ — every role sees what its own vehicle is reporting.
    ...(device !== undefined ? [{ id: 'params' as const, label: t('map.inspector.params'), icon: Radio }] : []),
    ...(device !== undefined && canWrite
      ? [
          { id: 'commands' as const, label: t('map.inspector.commands'), icon: Terminal },
          { id: 'settings' as const, label: t('map.inspector.settings'), icon: SlidersHorizontal },
        ]
      : []),
  ]

  // Never leave a tab selected that cannot render: a device with no registry row, or a viewer who
  // may not write, has only the overview, and a blank panel reads as broken.
  const effective: InspectorTab = tabs.some((x) => x.id === tab) ? tab : 'overview'

  if (effective === 'overview') {
    // The overview IS the InfoCard — one implementation, and it keeps its own testids and layout.
    return (
      <div data-testid="inspector" className="min-h-0 flex-1">
        <InfoCard
          device={live}
          name={name}
          follow={follow}
          trail={trail}
          onFollow={onFollow}
          onTrail={onTrail}
          onClose={onClose}
          tabs={tabs.length > 1 ? <TabStrip tabs={tabs} active={effective} onSelect={setTab} /> : undefined}
        />
      </div>
    )
  }

  return (
    <Card data-testid="inspector" className="min-h-0 flex-1 rounded-none border-0 bg-transparent shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <StatusDot status={live.status} />
          {name ?? live.ev.deviceId}
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label={t('info.close')}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <TabStrip tabs={tabs} active={effective} onSelect={setTab} />
        {/* keyed by device so a panel never carries state across a selection change — an armed
            destructive confirm or a half-dragged slider must not follow the operator to another
            vehicle (the devices table keys these the same way, for the same reason) */}
        {device !== undefined && effective === 'params' && <ParamsTab key={`par-${device.id}`} deviceId={device.id} />}
        {device !== undefined && effective === 'commands' && <CommandsCard key={`cmd-${device.id}`} device={device} />}
        {device !== undefined && effective === 'settings' && (
          <SettingsCard key={`set-${device.id}`} device={device} canWrite={canWrite} />
        )}
      </CardContent>
    </Card>
  )
}

function TabStrip({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: InspectorTab; label: string; icon: typeof Activity }[]
  active: InspectorTab
  onSelect: (t: InspectorTab) => void
}) {
  return (
    <div className="flex gap-1 border-b" role="tablist" data-testid="inspector-tabs">
      {tabs.map((tb) => (
        <button
          key={tb.id}
          type="button"
          role="tab"
          aria-selected={tb.id === active}
          onClick={() => onSelect(tb.id)}
          data-testid={`inspector-tab-${tb.id}`}
          className={cn(
            'flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-xs font-medium transition-colors',
            tb.id === active ? 'border-b-2 border-accent text-accent' : 'text-muted hover:text-text',
          )}
        >
          <tb.icon className="h-3.5 w-3.5" aria-hidden />
          {tb.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Everything the device is reporting — the conditional list the founder asked for: a parameter is
 * here because the tracker sent it, and absent because it did not.
 *
 * This is the view that would have ended the 2026-08-18 investigation in a minute instead of a day:
 * `GNSS Status 2`, `Sleep Mode 0`, `HDOP 1000` were all arriving and none of them were reachable
 * outside the database.
 */
function ParamsTab({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation()
  const { dt: dtFmt } = useFmt()
  const q = useQuery({
    queryKey: ['telemetry', deviceId],
    queryFn: () => getTelemetry(deviceId),
    refetchInterval: 30_000,
  })

  if (q.isLoading) return <p className="p-2 text-xs text-muted">{t('admin.loading')}</p>
  if (q.isError) return <p className="p-2 text-xs text-danger" role="alert">{t('map.inspector.paramsError')}</p>
  if (!hasTelemetry(q.data)) return <p className="p-2 text-xs text-muted">{t('map.inspector.paramsEmpty')}</p>

  const d = q.data
  /**
   * The promoted columns are prepended, because `attrs` does NOT contain them.
   *
   * The pipeline lifts AVL 239/240/16 (ignition, movement, odometer) and the GPS scalars into their
   * own columns and removes them from attrs. This panel's contract is "a parameter is here because
   * the tracker sent it, and absent because it did not" — so a correctly wired ignition showing no
   * ignition row would read as "not being reported" and send a technician to a working vehicle.
   */
  const promoted = [
    { key: 'satellites', label: t('info.satellites'), value: d.satellites },
    { key: 'ignition', label: t('info.ignition'), value: d.ignition },
    { key: 'movement', label: t('map.inspector.movement'), value: d.movement },
    { key: 'odometer', label: t('map.inspector.odometer'), value: d.odometerM },
    { key: 'altitude', label: t('map.inspector.altitude'), value: d.altitude },
  ].filter((r) => r.value !== null && r.value !== undefined)

  const rows = telemetryRows(d.attrs)
  return (
    <div data-testid="params-tab">
      {/* Age, always. A device that died three days ago would otherwise render a full, confident,
          present-tense list on a panel whose whole claim is "what this device is reporting now". */}
      <p className="pb-1 text-[11px] text-muted" data-testid="params-age">
        {t('map.inspector.paramsAt', { when: dtFmt(d.fixTime) })}
      </p>
      {promoted.length > 0 && (
        <dl className="divide-y divide-line border-b border-line text-xs">
          {promoted.map((r) => (
            <div key={r.key} className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="min-w-0 truncate text-muted">{r.label}</dt>
              <dd className="shrink-0 tabular-nums text-text">
                {typeof r.value === 'boolean' ? (r.value ? t('info.on') : t('info.off')) : String(r.value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <dl className="divide-y divide-line text-xs">
        {rows.map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className={cn('min-w-0 truncate', r.documented ? 'text-muted' : 'text-muted italic')} title={r.key}>
              {r.label}
            </dt>
            <dd className="shrink-0 tabular-nums text-text">{r.value}</dd>
          </div>
        ))}
      </dl>
      {rows.length === 0 && <p className="p-2 text-xs text-muted">{t('map.inspector.paramsEmpty')}</p>}
      {/* An `io_<id>` row means this model's own wiki page does not document that element — a fact
          about Teltonika's documentation, not a gap in ours, and worth naming as such. */}
      {rows.some((r) => !r.documented) && (
        <p className="pt-2 text-[11px] text-muted">{t('map.inspector.paramsUndocumented')}</p>
      )}
    </div>
  )
}
