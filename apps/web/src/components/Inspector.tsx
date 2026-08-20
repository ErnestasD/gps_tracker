import { Activity, Bell, Crosshair, Gauge, Radio, Route as RouteIcon, Satellite, Shield, SlidersHorizontal, Terminal, X } from 'lucide-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui-x/StatusDot'
import type { Device } from '@/lib/devices'
import { eventDetail, eventTone, listEvents } from '@/lib/events'
import type { GeofenceView } from '@orbetra/shared'
import type { DeviceLive } from '@/lib/liveStore'
import { cn } from '@/lib/utils'
import { useFmt } from '@/lib/datetime'
import { getTelemetry, hasTelemetry, highlightRows, telemetryRows, type LatestTelemetry } from '@/lib/telemetry'
import { fmtKm, listTrips } from '@/lib/trips'
import { useUnits } from '@/lib/units'
import { CommandsCard } from '@/routes/app/devices/commands'
import { SettingsCard } from '@/routes/app/devices/settings'

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
 * Everything on the panel is conditional on the device having actually reported it. The design this
 * was ported from shows fuel, battery and an address for every vehicle because its data was
 * generated; here a tile that is missing means the tracker does not send that element, and that
 * absence is itself the answer to "why can't I see the fuel level".
 *
 * A tab whose data needs a `Device` (not just a live position) is only offered when the registry row
 * is available — a device streaming positions we have no CRUD record for can still be watched, but
 * cannot be commanded.
 */
export type InspectorTab = 'overview' | 'params' | 'commands' | 'settings' | 'events' | 'fences'

export function Inspector({
  live,
  device,
  name,
  driver,
  follow,
  trail,
  canWrite,
  geofences,
  visibleFences,
  onToggleFence,
  onFollow,
  onTrail,
  onClose,
}: {
  live: DeviceLive
  /** The registry row, when we have it. Absent ⇒ only the overview is meaningful. */
  device: Device | undefined
  name?: string
  /** The assigned driver's name, when the fleet has recorded one. */
  driver?: string | null
  follow: boolean
  trail: boolean
  canWrite: boolean
  geofences: GeofenceView[]
  visibleFences: ReadonlySet<string>
  onToggleFence: (id: string) => void
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

  const telemetry = useQuery({
    queryKey: ['telemetry', live.ev.deviceId],
    queryFn: () => getTelemetry(live.ev.deviceId),
    refetchInterval: 30_000,
  })
  const latest = hasTelemetry(telemetry.data) ? telemetry.data : undefined

  /**
   * Commands and settings are WRITES, and the devices table gates them on `canWrite` for a stated
   * reason: a viewer's click 403s. Offering them here anyway would have put the Codec-12 console —
   * `cpureset`, `deleterecords` — one click from the landing page for a role the server refuses,
   * with a bare "could not send" as the only feedback. Authorization held; the gate did not.
   */
  const tabs: { id: InspectorTab; label: string; icon: typeof Activity }[] = [
    { id: 'overview', label: t('map.inspector.overview'), icon: Activity },
    // Parameters and events are READS — every role sees what its own vehicle is reporting, and a
    // device with no registry row is exactly the one whose parameters answer "what IS this". It was
    // gated on the registry row out of habit; the panel takes telemetry, never a `Device`.
    { id: 'params', label: t('map.inspector.params'), icon: Radio },
    { id: 'events', label: t('map.inspector.events'), icon: Bell },
    ...(device !== undefined && canWrite
      ? [
          { id: 'commands' as const, label: t('map.inspector.commands'), icon: Terminal },
          { id: 'settings' as const, label: t('map.inspector.settings'), icon: SlidersHorizontal },
        ]
      : []),
    ...(geofences.length > 0 ? [{ id: 'fences' as const, label: t('map.inspector.fences'), icon: Shield }] : []),
  ]

  // Never leave a tab selected that cannot render: a device with no registry row, or a viewer who
  // may not write, has only the overview, and a blank panel reads as broken.
  const effective: InspectorTab = tabs.some((x) => x.id === tab) ? tab : 'overview'

  return (
    <div data-testid="inspector" className="flex min-h-0 flex-1 flex-col">
      <Header
        live={live}
        device={device}
        name={name}
        driver={driver}
        latest={latest}
        onClose={onClose}
      />
      <TabStrip tabs={tabs} active={effective} onSelect={setTab} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {effective === 'overview' && (
          <OverviewTab
            live={live}
            latest={latest}
            follow={follow}
            trail={trail}
            onFollow={onFollow}
            onTrail={onTrail}
          />
        )}
        {/* keyed by device so a panel never carries state across a selection change — an armed
            destructive confirm or a half-dragged slider must not follow the operator to another
            vehicle (the devices table keys these the same way, for the same reason) */}
        {effective === 'params' && (
          <ParamsTab key={`par-${live.ev.deviceId}`} latest={latest} loading={telemetry.isLoading} error={telemetry.isError} />
        )}
        {effective === 'events' && <EventsTab key={`ev-${live.ev.deviceId}`} deviceId={live.ev.deviceId} />}
        {device !== undefined && effective === 'commands' && <CommandsCard key={`cmd-${device.id}`} device={device} />}
        {device !== undefined && effective === 'settings' && (
          <SettingsCard key={`set-${device.id}`} device={device} canWrite={canWrite} />
        )}
        {effective === 'fences' && (
          <FencesTab geofences={geofences} visibleFences={visibleFences} onToggle={onToggleFence} />
        )}
      </div>
    </div>
  )
}

/** Relative time for Live contexts only (spec §3 time rule); Intl, no date math. */
function relTime(fixTimeMs: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const deltaS = Math.round((fixTimeMs - Date.now()) / 1_000)
  if (deltaS > -60) return rtf.format(deltaS, 'second')
  if (deltaS > -3_600) return rtf.format(Math.round(deltaS / 60), 'minute')
  return rtf.format(Math.round(deltaS / 3_600), 'hour')
}

function Header({
  live,
  device,
  name,
  driver,
  latest,
  onClose,
}: {
  live: DeviceLive
  device: Device | undefined
  name?: string
  driver?: string | null
  latest: LatestTelemetry | undefined
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { speed, distanceM } = useUnits()
  const { ev, status } = live

  /**
   * The four numbers worth a glance, in the order they are worth it — and only the ones this
   * vehicle actually sends. Speed and satellites come from the live event, so they are always
   * there; odometer, voltage and levels come from `attrs` and appear per model.
   */
  const attrs = latest?.attrs ?? {}
  /** Finds the element by its dictionary name, and returns the name AS THE DEVICE SPELLED IT —
   *  the tile is labelled with the parameter's real name, not with the lower-case search term. */
  const attr = (wanted: string): { key: string; value: unknown } | undefined => {
    const key = Object.keys(attrs).find((k) => k.toLowerCase() === wanted)
    return key === undefined ? undefined : { key, value: attrs[key] }
  }
  const tiles: { key: string; icon: typeof Gauge; value: string; unit: string }[] = [
    // a null speed means this model does not report it — "0" would read as "stopped", which is a
    // different fact and the one an operator would act on
    { key: 'speed', icon: Gauge, value: ev.speed === null ? '—' : speed(ev.speed), unit: t('info.speed') },
    { key: 'sats', icon: Satellite, value: String(ev.satellites), unit: t('info.satellites') },
  ]
  if (latest?.odometerM != null && latest.odometerM !== '') {
    const m = Number(latest.odometerM)
    if (Number.isFinite(m)) tiles.push({ key: 'odo', icon: RouteIcon, value: distanceM(m), unit: t('map.inspector.odometer') })
  }
  for (const [wanted, icon] of [['battery level', Activity], ['fuel level', Activity], ['gsm signal', Radio], ['external voltage', Activity]] as const) {
    if (tiles.length >= 4) break
    const found = attr(wanted)
    if (found !== undefined && typeof found.value === 'number') {
      tiles.push({ key: wanted, icon, value: String(found.value), unit: found.key })
    }
  }

  // plate · driver · IMEI — whatever of it the fleet has recorded, never a placeholder
  const sub = [device?.plate, driver, device !== undefined ? `IMEI ${device.imei}` : undefined].filter(
    (x): x is string => typeof x === 'string' && x !== '',
  )

  return (
    <div className="shrink-0 border-b border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={status} />
            <span className="truncate text-sm font-semibold text-text">{name ?? ev.deviceId}</span>
            <Badge variant={status === 'online' ? 'success' : status === 'stale' ? 'warn' : 'default'}>
              {t(`status.${status}`)}
            </Badge>
            {!ev.fixValid && <Badge variant="warn">{t('info.invalidFix')}</Badge>}
          </div>
          {sub.length > 0 && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted" data-testid="inspector-sub">
              {sub.join(' · ')}
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose} aria-label={t('info.close')}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5" data-testid="inspector-metrics">
        {tiles.map((m) => (
          <div key={m.key} className="rounded-md bg-surface-2 px-1.5 py-1.5 text-center">
            <m.icon className="mx-auto h-3 w-3 text-muted" aria-hidden />
            <div className="mt-0.5 truncate text-sm font-semibold tabular-nums text-text">{m.value}</div>
            <div className="truncate text-[9px] uppercase tracking-wide text-muted" title={m.unit}>{m.unit}</div>
          </div>
        ))}
      </div>
    </div>
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
  const { t } = useTranslation()
  return (
    <div
      className="scroll-strip flex shrink-0 gap-1 overflow-x-auto border-b border-line"
      role="tablist"
      aria-label={t('map.inspector.tabs')}
      data-testid="inspector-tabs"
    >
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

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Gauge; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {Icon !== undefined && <Icon className="h-3 w-3" aria-hidden />}
        {title}
      </div>
      {children}
    </div>
  )
}

function OverviewTab({
  live,
  latest,
  follow,
  trail,
  onFollow,
  onTrail,
}: {
  live: DeviceLive
  latest: LatestTelemetry | undefined
  follow: boolean
  trail: boolean
  onFollow: (v: boolean) => void
  onTrail: (v: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const { dt } = useFmt()
  const { ev } = live
  const trips = useQuery({
    queryKey: ['trips', 'device', ev.deviceId],
    queryFn: () => listTrips({ deviceId: ev.deviceId, limit: 5 }),
  })
  const highlights = latest !== undefined ? highlightRows(latest.attrs) : []

  return (
    <div className="space-y-3" data-testid="overview-tab">
      <Section title={t('map.inspector.position')}>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          {/* The coordinate is only shown when it is a real one: a device with no fix reports 0/0,
              and printing that as a position is how a vehicle ends up in the Gulf of Guinea. */}
          <KV
            k={t('map.inspector.coords')}
            v={live.fix === null ? '—' : `${live.fix.lat.toFixed(5)}, ${live.fix.lon.toFixed(5)}`}
          />
          <KV k={t('map.inspector.lastPacket')} v={dt(new Date(ev.fixTimeMs).toISOString())} />
          {/* The heading comes from the same last-valid fix the marker is rotated by. Reading
              `ev.course` printed "0°" — due north — for a device parked indoors, because a no-fix
              record carries angle 0 (spec §3.4): a heading manufactured by the absence of a fix,
              contradicting the arrow beside it. */}
          <KV k={t('map.inspector.heading')} v={live.fix === null ? '—' : `${Math.round(live.fix.course)}°`} />
          <KV
            k={t('info.ignition')}
            v={ev.ignition === null ? '—' : ev.ignition ? t('info.on') : t('info.off')}
          />
        </dl>
        <p className="mt-2 text-[11px] text-muted">{relTime(ev.fixTimeMs, i18n.language)}</p>
      </Section>

      {highlights.length > 0 && (
        <Section title={t('map.inspector.telemetry')} icon={Satellite}>
          <div className="space-y-2" data-testid="overview-telemetry">
            {highlights.map((h) => (
              <div key={h.key}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-muted">{h.label}</span>
                  <span className="shrink-0 font-mono font-medium tabular-nums text-text">{h.value}</span>
                </div>
                {h.pct !== null && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        h.tone === 'danger' ? 'bg-danger' : h.tone === 'warn' ? 'bg-warn' : 'bg-accent',
                      )}
                      style={{ width: `${Math.max(2, Math.min(100, h.pct * 100))}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={t('map.inspector.recentTrips')} icon={RouteIcon}>
        {trips.isLoading ? (
          <p className="text-xs text-muted">{t('admin.loading')}</p>
        ) : (trips.data?.length ?? 0) === 0 ? (
          <p className="text-xs text-muted">{t('map.inspector.noTrips')}</p>
        ) : (
          <ul className="space-y-1.5" data-testid="overview-trips">
            {(trips.data ?? []).map((tr) => (
              <li key={tr.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-text">{dt(tr.startTime)}</span>
                <span className="shrink-0 font-mono text-muted">{fmtKm(tr.distanceM)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          className={cn(follow && 'border-accent text-accent')}
          aria-pressed={follow}
          onClick={() => onFollow(!follow)}
          data-testid="follow-toggle"
        >
          <Crosshair className="h-3.5 w-3.5" aria-hidden />
          {t('info.follow')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className={cn(trail && 'border-accent text-accent')}
          aria-pressed={trail}
          onClick={() => onTrail(!trail)}
          data-testid="trail-toggle"
        >
          <RouteIcon className="h-3.5 w-3.5" aria-hidden />
          {t('info.trail')}
        </Button>
      </div>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted">{k}</dt>
      <dd className="truncate text-xs tabular-nums text-text">{v}</dd>
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
function ParamsTab({
  latest,
  loading,
  error,
}: {
  latest: LatestTelemetry | undefined
  loading: boolean
  error: boolean
}) {
  const { t } = useTranslation()
  const { dt: dtFmt } = useFmt()
  const [q, setQ] = useState('')

  if (loading) return <p className="p-2 text-xs text-muted">{t('admin.loading')}</p>
  if (error) return <p className="p-2 text-xs text-danger" role="alert">{t('map.inspector.paramsError')}</p>
  if (latest === undefined) return <p className="p-2 text-xs text-muted">{t('map.inspector.paramsEmpty')}</p>

  const d = latest
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

  const term = q.trim().toLowerCase()
  const rows = telemetryRows(d.attrs).filter((r) => term === '' || r.label.toLowerCase().includes(term) || r.key.toLowerCase().includes(term))
  return (
    <div data-testid="params-tab">
      {/* Age, always. A device that died three days ago would otherwise render a full, confident,
          present-tense list on a panel whose whole claim is "what this device is reporting now". */}
      <p className="pb-1 text-[11px] text-muted" data-testid="params-age">
        {t('map.inspector.paramsAt', { when: dtFmt(d.fixTime) })}
      </p>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        placeholder={t('map.inspector.paramsSearch')}
        aria-label={t('map.inspector.paramsSearch')}
        data-testid="params-search"
        className="mb-2 h-7 w-full rounded border border-line bg-transparent px-2 text-xs text-text placeholder:text-muted"
      />
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

/** What the pipeline decided about this vehicle: geofence crossings, overspeed, power cuts. */
function EventsTab({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const u = useUnits()
  const q = useQuery({
    queryKey: ['events', 'device', deviceId],
    queryFn: () => listEvents({ deviceId, limit: 15 }),
    refetchInterval: 60_000,
  })

  if (q.isLoading) return <p className="p-2 text-xs text-muted">{t('admin.loading')}</p>
  if (q.isError) return <p className="p-2 text-xs text-danger" role="alert">{t('map.inspector.eventsError')}</p>
  const rows = q.data ?? []
  if (rows.length === 0) return <p className="p-2 text-xs text-muted">{t('map.inspector.noEvents')}</p>

  return (
    <ul className="space-y-2" data-testid="events-tab">
      {rows.map((e) => {
        /**
         * The payload, not just the kind.
         *
         * "overspeed · 12:58" was everything this panel said, while the record itself carried
         * `speedKmh: 91, limitKmh: 90` and the rule that fired — and a geofence event carried the
         * zone's NAME and whether the vehicle entered or left it. The formatter that renders all of
         * that already existed for the events page, localized and unit-aware; this panel simply was
         * not calling it.
         *
         * `eventDetail` rather than the raw summary because the KIND is already on the badge beside
         * it: the same rule the map ticker uses, so the two cannot describe one event differently.
         */
        const detail = eventDetail(t, e, { fmtSpeed: u.speed, fmtVolume: u.volumeL })
        return (
          <li key={e.id} className="rounded-card border border-line p-2.5">
            <div className="flex items-center justify-between gap-2">
              <Badge variant={eventTone(e.kind)}>{t(`events.k.${e.kind}`, { defaultValue: e.kind })}</Badge>
              <span className="shrink-0 text-[10px] tabular-nums text-muted">{dt(e.at)}</span>
            </div>
            {detail !== '' && <p className="mt-1 text-xs text-text">{detail}</p>}
            {/* The rule someone configured, when the payload names one — "why did this fire"
                answered in a glance. Skipped when it merely repeats the kind: the offline sweeper
                writes the literal string 'device_offline' there, which is not a rule anyone wrote. */}
            {typeof e.payload?.['rule'] === 'string' && e.payload['rule'] !== e.kind && (
              <p className="text-[11px] text-muted">{String(e.payload['rule'])}</p>
            )}
            {e.acknowledgedAt !== null && (
              <p className="mt-1 text-[11px] text-muted">{t('map.inspector.acknowledged')}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Which zones the map draws. A read-only switchboard: creating zones stays on the geofences page. */
function FencesTab({
  geofences,
  visibleFences,
  onToggle,
}: {
  geofences: GeofenceView[]
  visibleFences: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2" data-testid="fences-tab">
      <p className="text-[11px] text-muted">{t('map.inspector.fencesHint')}</p>
      {geofences.map((g) => (
        <label
          key={g.id}
          className="flex cursor-pointer items-center gap-2 rounded-card border border-line p-2.5 text-xs"
        >
          <input
            type="checkbox"
            checked={visibleFences.has(g.id)}
            onChange={() => onToggle(g.id)}
            className="h-3.5 w-3.5 accent-[var(--admin-brand)]"
          />
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: g.color }} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-text">{g.name}</span>
          <span className="shrink-0 text-[11px] text-muted">{t(`geofences.${g.kind}`, { defaultValue: g.kind })}</span>
        </label>
      ))}
    </div>
  )
}
