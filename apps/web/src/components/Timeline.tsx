import { Pause, Play, Route as RouteIcon, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useFmt } from '@/lib/datetime'
import type { ScrubState } from '@/lib/liveStore'
import { placeAt, pointAt, type TrackPoint } from '@/lib/telemetry'
import { canScrub, firstPlaceBack, quickJumps, SPAN_OPTIONS_H, spanMinutes, type TrackWindow } from '@/lib/trackWindow'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'

/**
 * The selected device's history as a waveform, scrubbable to the SECOND, docked under the map.
 *
 * Built entirely from data the platform already stores: the positions endpoint the playback page
 * uses, over the page's window. Nothing here is simulated — the design's version wandered devices
 * around with a sine function, which is fine for a mockup and unusable in a product where an
 * operator will take what they see as evidence.
 *
 * Rules it inherits:
 *  - an invalid fix never places anything on the map (invariant I6), but it is still SHOWN on the
 *    timeline as a no-fix stretch, because "reporting without a fix" and "not reporting" are
 *    different answers to "where was the truck at 14:30".
 *  - the scrubber reports the newest point at or before the moment, never the nearest: a track is a
 *    sequence of states, and at 14:32:07 the vehicle was where it last reported.
 *  - the internal unit is the SECOND, not the minute (founder: "reik tikslumo"). A tracker reports
 *    every few seconds when driving; a minute grid could not even land on individual reports.
 *
 * It is a fixture of the workspace rather than a popup, because a bar that appears only after two
 * clicks is a bar nobody finds. With no vehicle selected it says so and does nothing — the history
 * we hold is per device, and pretending otherwise would mean replaying a fleet we never queried.
 */

/**
 * Replay pacing: a TIME-LAPSE FACTOR against real time, not "span per N seconds".
 *
 * Span-relative pacing meant the step scaled with the zoom — a 24 h span at its gentlest still
 * jumped over two minutes of history per tick, and the founder's ask was the opposite: to WATCH,
 * down to the second. 1× is real time (one second of history per second), and each preset is a
 * plain multiplier of it, the same at every zoom. The tick accumulates fractionally (posRef):
 * at 1× a 90 ms tick advances 0.09 s, which rounding alone would swallow forever.
 */
const REPLAY_TICK_MS = 90
const REPLAY_SPEEDS = [
  { label: '1×', factor: 1 },
  { label: '10×', factor: 10 },
  { label: '60×', factor: 60 },
  { label: '600×', factor: 600 },
] as const
const DEFAULT_SPEED = 2 // 60× — a day in 24 min, an hour in a minute

/** An event pin on the track (SoundCloud-style): the page maps its events query to this. */
export interface TimelineEvent {
  id: string
  kind: string
  atMs: number
}

/**
 * Kind → pin colour. Literal hexes, not theme tokens: two kinds must never collapse into one
 * colour because a palette happens to reuse a token, and these must read on both themes.
 * Severity still rhymes with eventSeverity(): reds are critical, ambers warning, cool hues info.
 */
const KIND_COLOR: Record<string, string> = {
  overspeed: '#ef4444',
  panic: '#b91c1c',
  power_cut: '#f97316',
  fuel_theft: '#f43f5e',
  low_battery: '#eab308',
  geofence: '#8b5cf6',
  ignition: '#22c55e',
  din_change: '#06b6d4',
  device_offline: '#64748b',
}
const FALLBACK_PIN = '#94a3b8'

/** Axis cadence by span: minor tick marks in the axis strip, clock labels at the round times. */
const tickStepMin = (spanMin: number) => (spanMin >= 1440 ? 60 : spanMin >= 360 ? 30 : spanMin >= 180 ? 15 : 5)
const labelStepMin = (spanMin: number) =>
  spanMin >= 1440 ? 180 : spanMin >= 720 ? 120 : spanMin >= 360 ? 60 : spanMin >= 180 ? 30 : 15

/**
 * Waveform geometry. Bars grow up from BASELINE; a faded reflection hangs below it.
 *
 * A bucket's value is the newest valid-fix speed AT OR BEFORE its end — the scrubber's own rule —
 * carried for at most CARRY_MS. Carrying is what makes the shape CONTINUOUS: a tracker reporting
 * once a minute filled every fourth 15-second bucket, and the comb of gaps read as a broken
 * device. A report is a state that persists until the next one; only silence longer than the
 * slowest sane reporting cadence is a real gap, and a real gap still renders as one. 6 min,
 * because a parked Teltonika's periodic report is typically 300 s — 3 min turned every parked
 * stretch into dashes.
 */
const WAVE_H = 100
const BASELINE = 70
const CARRY_MS = 6 * 60_000
const barsFor = (spanSec: number) => (spanSec >= 7_200 ? 240 : 120)

export function Timeline({
  deviceId,
  name,
  points,
  times,
  window,
  loading,
  stale = false,
  truncated,
  onScrub,
  events = [],
  onScrubTime,
  onSpan,
}: {
  /** null ⇒ nothing selected: the bar stays, disabled, rather than vanishing. */
  deviceId: string | null
  name: string | null
  points: readonly TrackPoint[]
  /** `points`' timestamps, parsed once by the page that owns the query. */
  times: readonly number[]
  /**
   * The window the points were FETCHED for — the axis and the payload must be the same window.
   *
   * Computing `to` here while the query recomputed its own on every refetch let the two drift: the
   * left-edge tick meant a different moment than the earliest row we held, and nudging the slider
   * off "now" jumped the map by however long the tab had been in the background.
   */
  window: TrackWindow
  loading: boolean
  /** The points are the PREVIOUS window's, still being refreshed — usable, but say so. */
  stale?: boolean
  truncated: boolean
  /** null ⇒ back to live, 'unknown' ⇒ a moment we hold no position for: hold, never fall back. */
  onScrub: (point: ScrubState) => void
  /** The window's events, drawn as coloured pins on the track; clicking one scrubs to it. */
  events?: readonly TimelineEvent[]
  /** The scrubbed instant as ISO, null when live — for the page to replay OTHER data (the
   *  inspector's parameters) at the same moment. Separate from onScrub because a no-fix moment
   *  has no place but very much has a time. */
  onScrubTime?: (iso: string | null) => void
  /** Zoom: the page swaps the whole window for an `hours`-long one ending at the same "now". */
  onSpan?: (hours: number) => void
}) {
  const { t } = useTranslation()
  const { d: dateOnly, dt, tm, tms } = useFmt()
  const { speed } = useUnits()
  /** SECONDS back from now: 0 is live. */
  const [back, setBack] = useState(0)
  const [replaying, setReplaying] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(DEFAULT_SPEED)
  /** Pointer position over the wave as a 0..1 fraction — the hover time readout. */
  const [hover, setHover] = useState<number | null>(null)

  // A new vehicle starts at "now", never at whatever moment the previous one was parked on.
  const [lastId, setLastId] = useState(deviceId)
  if (lastId !== deviceId) {
    setLastId(deviceId)
    setBack(0)
    setReplaying(false)
  }

  const spanMin = spanMinutes(window)
  const spanSec = spanMin * 60
  const firstBack = useMemo(() => firstPlaceBack(points, window, times), [points, window, times])
  const atMs = window.to - back * 1_000
  const current = useMemo(() => (back === 0 ? undefined : pointAt(points, atMs, times)), [points, times, atMs, back])
  const disabled = deviceId === null || points.length === 0 || !canScrub(firstBack)

  const scrub = (rawSeconds: number) => {
    // clamped, so no caller can name a moment outside the window the points were fetched for
    const seconds = Math.min(spanSec, Math.max(0, Math.round(rawSeconds)))
    setBack(seconds)
    onScrubTime?.(seconds === 0 ? null : new Date(window.to - seconds * 1_000).toISOString())
    if (seconds === 0) {
      onScrub(null)
      return
    }
    /**
     * An invalid fix is a real state but not a place, so the map must not move to it — and it must
     * not fall back to LIVE either. Passing null there put the camera on the vehicle's present
     * position while the readout named a past moment with no fix, which is a worse lie than showing
     * nothing. Per spec §3.4 a no-fix record repeats the last valid position, so the camera holds
     * at the last place the vehicle was actually seen; before the first one there is nowhere to
     * hold, and 'unknown' says exactly that.
     */
    const place = placeAt(points, window.to - seconds * 1_000, times)
    onScrub(place !== undefined ? { lat: place.lat, lon: place.lon, course: place.course } : 'unknown')
  }

  /**
   * Replay walks the scrubber forward to the present and stops there, driving the same `scrub` the
   * slider does — so the map follows the replay instead of it being a decorative animation.
   *
   * The interval depends on `replaying` ALONE and reads everything else through refs. Depending on
   * `points` or on the `onScrub` prop restarted the timer on every 1 Hz store emit, which reset the
   * 90 ms tick before it ever fired; and stepping inside a `setBack` updater ran a side effect in a
   * function React is allowed to call twice.
   */
  const backRef = useRef(back)
  const scrubRef = useRef(scrub)
  const spanSecRef = useRef(spanSec)
  const speedRef = useRef(speedIdx)
  useLayoutEffect(() => {
    backRef.current = back
    scrubRef.current = scrub
    spanSecRef.current = spanSec
    speedRef.current = speedIdx
  })
  useEffect(() => {
    if (!replaying) return
    /**
     * The replay is a CLOCK, not a tick counter. Counting ticks assumed the interval actually
     * fires every 90 ms; under the workspace's per-scrub re-renders it fires late, and at 1× the
     * "second per second" quietly became a second per six. Position is derived from wall time
     * (performance.now), so jank changes smoothness, never the rate; a mid-replay speed change
     * rebases the anchor so the transition is seamless. And only a change of the ROUNDED second
     * reaches scrub() — at 1× that is one store emit per second instead of eleven, which is also
     * what removes most of the jank.
     */
    let startWall = performance.now()
    let startPos = backRef.current
    let lastFactor = (REPLAY_SPEEDS[speedRef.current] ?? REPLAY_SPEEDS[DEFAULT_SPEED]).factor
    let lastSent = Number.NaN
    const iv = setInterval(() => {
      const factor = (REPLAY_SPEEDS[speedRef.current] ?? REPLAY_SPEEDS[DEFAULT_SPEED]).factor
      const now = performance.now()
      if (factor !== lastFactor) {
        startPos = startPos - (lastFactor * (now - startWall)) / 1_000
        startWall = now
        lastFactor = factor
      }
      const next = startPos - (factor * (now - startWall)) / 1_000
      if (next <= 0) {
        setReplaying(false)
        scrubRef.current(0)
        return
      }
      const rounded = Math.round(next)
      if (rounded === lastSent) return
      lastSent = rounded
      scrubRef.current(next)
    }, REPLAY_TICK_MS)
    return () => clearInterval(iv)
  }, [replaying])

  /**
   * A zoom under a scrubbed operator keeps the MOMENT, clamped into the new window — losing the
   * position they were inspecting is exactly what "zoom in to look closer" must not do. The
   * re-scrub also re-resolves the place against the newly fetched points.
   */
  const spanRef = useRef(spanSec)
  useEffect(() => {
    if (spanRef.current === spanSec) return
    spanRef.current = spanSec
    if (backRef.current > 0) scrubRef.current(Math.min(backRef.current, spanSec))
  }, [spanSec])

  /**
   * A track that becomes unscrubbable under a scrubbed operator must return them to LIVE.
   *
   * Stopping the replay was not enough: `back` stayed set, every control greyed out at once, the
   * page kept the window frozen because it still believed a scrub was in progress, and the camera
   * stayed eased on a historic position — with no enabled control left to get back.
   */
  useEffect(() => {
    if (!disabled) return
    setReplaying(false)
    setBack(0)
    scrubRef.current(0)
  }, [disabled])

  const quick = useMemo(() => quickJumps(spanMin), [spanMin])
  const pct = ((spanSec - back) / spanSec) * 100
  const atIso = new Date(atMs).toISOString()
  // O(n) over up to 10 000 points, and this component re-renders at the store's 1 Hz cadence
  const valid = useMemo(() => points.filter((p) => p.fixValid).length, [points])

  /**
   * The axis: ROUND wall-clock times (14:00, 15:00 …), not offsets from a bucketed "now". The
   * previous "-150 min." labels were relative to a `to` that itself moves in 5-minute buckets, so
   * no label ever named a moment an operator could repeat out loud. Alignment is epoch-based;
   * hour-fraction zones shift the printed minutes uniformly, which keeps the grid honest.
   */
  const axis = useMemo(() => {
    const span = window.to - window.from
    if (span <= 0) return []
    const tickMs = tickStepMin(spanMin) * 60_000
    const labelMs = labelStepMin(spanMin) * 60_000
    const out: { ms: number; pct: number; labeled: boolean }[] = []
    for (let at = Math.ceil(window.from / tickMs) * tickMs; at < window.to; at += tickMs) {
      out.push({ ms: at, pct: ((at - window.from) / span) * 100, labeled: at % labelMs === 0 })
    }
    return out
  }, [window, spanMin])

  /** Max valid-fix speed per bucket, at-or-before with carry (see the geometry note above). Max,
   *  not mean — a bucket 90 % parked and 10 % at 80 km/h must not average down into idle. */
  const bars = useMemo(() => {
    const span = window.to - window.from
    if (span <= 0 || points.length === 0) return []
    const n = barsFor(Math.round(span / 1_000))
    const out: (number | null)[] = Array.from({ length: n }, () => null)
    let j = 0
    let lastValid = -1
    for (let b = 0; b < n; b++) {
      const bucketEnd = window.from + ((b + 1) * span) / n
      while (j < points.length && (times[j] ?? Number.POSITIVE_INFINITY) <= bucketEnd) {
        if (points[j]!.fixValid) lastValid = j
        j++
      }
      if (lastValid === -1) continue
      const seenAt = times[lastValid] ?? 0
      if (bucketEnd - seenAt > CARRY_MS) continue
      const p = points[lastValid]!
      out[b] = Math.max(0, p.speed ?? 0)
    }
    return out
  }, [points, times, window])
  const maxSpeed = useMemo(() => bars.reduce<number>((m, b) => (b !== null && b > m ? b : m), 10), [bars])
  const nBars = bars.length
  /** One set of <rect>s in currentColor, rendered twice — a dim base and a clip-path'ed played
   *  overlay — so the 1 Hz re-render recolours via CSS instead of restyling 240 nodes. */
  const waveform = useMemo(() => (
    <svg className="h-full w-full" viewBox={`0 0 ${Math.max(1, nBars)} ${WAVE_H}`} preserveAspectRatio="none" aria-hidden>
      {bars.map((b, i) => {
        if (b === null) return null
        // even a parked bucket gets a visible stub — it REPORTED, unlike a null gap
        const h = 5 + (b / maxSpeed) * (BASELINE - 9)
        return (
          <g key={i} fill="currentColor">
            <rect x={i + 0.14} width={0.72} y={BASELINE - h} height={h} rx={0.3} />
            <rect x={i + 0.14} width={0.72} y={BASELINE + 2} height={h * 0.32} rx={0.3} opacity={0.28} />
          </g>
        )
      })}
    </svg>
  ), [bars, maxSpeed, nBars])

  // event pins, clamped to the window: the feed can hand back a row a bucket newer than `to`
  const pins = useMemo(() => {
    const span = window.to - window.from
    if (span <= 0) return []
    return events
      .filter((e) => e.atMs >= window.from && e.atMs <= window.to)
      .map((e) => ({ ...e, pct: ((e.atMs - window.from) / span) * 100, color: KIND_COLOR[e.kind] ?? FALLBACK_PIN }))
  }, [events, window])
  // the legend names only the kinds actually on the track — a nine-entry key for two pins is noise
  const legend = useMemo(() => [...new Set(pins.map((p) => p.kind))], [pins])

  const hoverMs = hover === null ? null : window.from + hover * (window.to - window.from)

  return (
    <div
      className="shrink-0 border-t border-line bg-surface px-3 py-2 md:px-4"
      data-testid="timeline"
    >
      <div className="flex items-center gap-2 md:gap-3">
        <button
          type="button"
          // Nothing to replay when the only placeable row is inside the last minute — a tracker
          // installed twenty minutes ago. Pressing Play there used to scrub to a moment BEFORE that
          // row: a frozen camera reading "no report at …".
          disabled={disabled}
          onClick={() => {
            if (replaying) {
              setReplaying(false)
              return
            }
            // Start at the first row we hold, not at the window's edge: the window opens earlier
            // than the earliest position by construction, so starting there spent the first ticks
            // on 'unknown' — a frozen camera and "no report at …", which reads as broken.
            if (back === 0 && canScrub(firstBack)) scrub(firstBack * 60)
            setReplaying(true)
          }}
          aria-pressed={replaying}
          aria-label={
            // "no history" is a CLAIM, and during the first fetch we do not know it yet: the button
            // was telling a screen-reader operator the vehicle had none while the summary beside it
            // still said "Loading…"
            disabled && deviceId !== null && !loading
              ? t('map.timeline.nothingToReplay')
              : t(replaying ? 'map.timeline.stopReplay' : 'map.timeline.replay', { hours: Math.round(spanMin / 60) })
          }
          data-testid="timeline-replay"
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line transition-colors disabled:opacity-40',
            replaying ? 'border-accent text-accent' : 'text-muted hover:text-text',
          )}
        >
          {replaying ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </button>
        {/* replay pace, cycling the presets — a running replay picks the new pace up on its next
            tick, so slowing down mid-replay works exactly when it is wanted */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setSpeedIdx((i) => (i + 1) % REPLAY_SPEEDS.length)}
          title={t('map.timeline.replaySpeed')}
          aria-label={`${t('map.timeline.replaySpeed')}: ${(REPLAY_SPEEDS[speedIdx] ?? REPLAY_SPEEDS[DEFAULT_SPEED]).label}`}
          data-testid="timeline-speed"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line font-mono text-[11px] tabular-nums text-muted transition-colors hover:text-text disabled:opacity-40"
        >
          {(REPLAY_SPEEDS[speedIdx] ?? REPLAY_SPEEDS[DEFAULT_SPEED]).label}
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
              <RouteIcon className="h-3 w-3 shrink-0" aria-hidden />
              <span
                className={cn('shrink-0 tabular-nums', back === 0 ? 'text-text' : 'text-warn')}
                data-testid="timeline-at"
              >
                {back === 0 ? t('map.timeline.now') : `${dateOnly(atIso)} ${tms(atIso)}`}
              </span>
              {back > 0 && (
                <span className="truncate">
                  ·{' '}
                  {current === undefined
                    ? t('map.timeline.noData', { when: tms(atIso) })
                    : !current.fixValid
                      ? t('map.timeline.noFix')
                      : // null speed is "this model does not report it", not "stopped"
                        current.speed === null
                        ? '—'
                        : speed(current.speed)}
                </span>
              )}
            </span>
            <span
              className={cn('hidden shrink-0 text-[11px] text-muted sm:inline', stale && 'opacity-60')}
              title={stale ? t('map.timeline.refreshing') : undefined}
              data-testid="timeline-summary"
            >
              {deviceId === null
                ? t('map.timeline.pickDevice')
                : loading
                  ? t('admin.loading')
                  : truncated
                    ? t('map.timeline.truncated', { points: points.length })
                    : `${name ?? ''} · ${t('map.timeline.summary', { points: points.length, valid })}`}
            </span>
          </div>

          <div
            className="relative h-14"
            data-testid="timeline-wave"
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              if (r.width > 0) setHover(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
            }}
            onPointerLeave={() => setHover(null)}
          >
            {/* labeled clock times only as faint full-height gridlines; minor marks live in the
                axis strip — a full grid behind the bars read as noise, not as an instrument */}
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              {axis.filter((tk) => tk.labeled).map((tk) => (
                <span key={tk.ms} className="absolute inset-y-0 w-px bg-line opacity-60" style={{ left: `${tk.pct}%` }} />
              ))}
            </div>
            {/* the waveform, twice: a dim base, and a colour overlay clipped at the playhead —
                the played/unplayed split is a clip-path, exactly the reference site's trick */}
            <div className="pointer-events-none absolute inset-0 text-muted opacity-40">{waveform}</div>
            <div
              className={cn('pointer-events-none absolute inset-0', back === 0 ? 'text-accent' : 'text-warn')}
              style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
            >
              {waveform}
            </div>
            {/* baseline so an empty stretch still reads as a track, not a blank */}
            <div
              className="pointer-events-none absolute left-0 right-0 h-px bg-line"
              style={{ top: `${(BASELINE / WAVE_H) * 100}%` }}
              aria-hidden
            />
            {/* hover: the moment under the cursor, to the second — read before you commit a drag */}
            {hoverMs !== null && !disabled && (
              <div className="pointer-events-none absolute inset-y-0" style={{ left: `${(hover ?? 0) * 100}%` }} aria-hidden>
                <span className="absolute inset-y-0 left-0 w-px bg-text opacity-30" />
                <span
                  className={cn(
                    'absolute top-0 whitespace-nowrap rounded border border-line bg-surface px-1 py-px font-mono text-[10px] text-text shadow-sm',
                    (hover ?? 0) > 0.9 ? 'right-1' : 'left-1',
                  )}
                >
                  {tms(new Date(hoverMs).toISOString())}
                </span>
              </div>
            )}
            {/* the playhead: a hairline with a grab dot on the baseline — the native round thumb
                is hidden (transparent, full-height, so the finger target stays) */}
            {!disabled && (
              <div
                className="pointer-events-none absolute inset-y-0 -translate-x-1/2"
                style={{ left: `${pct}%` }}
                aria-hidden
              >
                <span className={cn('absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full', back === 0 ? 'bg-accent' : 'bg-warn')} />
                <span
                  className={cn(
                    'absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface',
                    back === 0 ? 'bg-accent' : 'bg-warn',
                  )}
                  style={{ top: `${(BASELINE / WAVE_H) * 100}%` }}
                />
              </div>
            )}
            <input
              type="range"
              min={0}
              max={spanSec}
              step={1}
              // reversed: the range's own value counts UP toward now, while `back` counts SECONDS
              // backwards from it — so value 0 (left) is the start of the window and `spanSec`
              // (right) is now
              value={spanSec - back}
              onChange={(e) => {
                setReplaying(false)
                scrub(spanSec - Number(e.currentTarget.value))
              }}
              aria-label={t('map.timeline.scrub', { hours: Math.round(spanMin / 60) })}
              data-testid="timeline-scrub"
              disabled={disabled}
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed [&::-moz-range-thumb]:h-full [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-webkit-slider-thumb]:h-full [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-transparent"
            />
            {/* event pins ride ABOVE the input: a pin is a destination, so clicking it scrubs
                there. A hairline with a head dot, SoundCloud-marker style — 2 px wide, narrow
                enough that a drag still lands on the track. */}
            {pins.map((ev) => (
              <button
                key={ev.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setReplaying(false)
                  scrub(Math.round((window.to - ev.atMs) / 1_000))
                }}
                title={`${t(`events.k.${ev.kind}`)} · ${dt(new Date(ev.atMs).toISOString())}`}
                aria-label={`${t(`events.k.${ev.kind}`)} · ${dt(new Date(ev.atMs).toISOString())}`}
                data-testid="timeline-pin"
                data-kind={ev.kind}
                className="group absolute inset-y-0 w-1 -translate-x-1/2 disabled:cursor-not-allowed"
                style={{ left: `${ev.pct}%` }}
              >
                <span
                  className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 opacity-70 transition-opacity group-hover:opacity-100"
                  style={{ backgroundColor: ev.color }}
                  aria-hidden
                />
                <span
                  className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full ring-1 ring-surface transition-transform group-hover:scale-150"
                  style={{ backgroundColor: ev.color }}
                  aria-hidden
                />
              </button>
            ))}
          </div>

          {/* the axis strip: minor tick marks, clock labels at the round times, "now" at the edge */}
          <div className="relative mt-0.5 hidden h-4 text-[10px] text-muted sm:block" aria-hidden>
            {axis.map((tk) => (
              <span
                key={`m${tk.ms}`}
                className={cn('absolute top-0 w-px bg-line', tk.labeled ? 'h-1.5 opacity-90' : 'h-1 opacity-50')}
                style={{ left: `${tk.pct}%` }}
              />
            ))}
            {axis.filter((tk) => tk.labeled && tk.pct > 1.5 && tk.pct < 95).map((tk) => (
              <span key={tk.ms} className="absolute top-1 -translate-x-1/2 tabular-nums" style={{ left: `${tk.pct}%` }}>
                {tm(new Date(tk.ms).toISOString())}
              </span>
            ))}
            <span className="absolute right-0 top-1 font-medium text-text">{t('map.timeline.now')}</span>
          </div>

          {legend.length > 0 && (
            <div className="mt-0.5 hidden flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted md:flex" data-testid="timeline-legend">
              {legend.map((k) => (
                <span key={k} className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: KIND_COLOR[k] ?? FALLBACK_PIN }} aria-hidden />
                  {t(`events.k.${k}`)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* zoom: swap the whole axis for a shorter/longer one ending at the same "now" —
            always visible, because on a phone it is the only way to reach fine detail */}
        {onSpan !== undefined && (
          <div className="flex shrink-0 items-center gap-0.5" data-testid="timeline-zoom">
            <button
              type="button"
              disabled={spanMin <= SPAN_OPTIONS_H[0] * 60}
              onClick={() => {
                const shorter = [...SPAN_OPTIONS_H].reverse().find((h) => h * 60 < spanMin)
                if (shorter !== undefined) onSpan(shorter)
              }}
              aria-label={t('map.timeline.zoomIn')}
              title={t('map.timeline.zoomIn')}
              data-testid="timeline-zoom-in"
              className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:text-text disabled:opacity-40"
            >
              <ZoomIn className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span className="w-12 text-center text-[11px] tabular-nums text-muted" data-testid="timeline-span">
              {t('map.timeline.span', { hours: Math.round(spanMin / 60) })}
            </span>
            <button
              type="button"
              disabled={spanMin >= SPAN_OPTIONS_H[SPAN_OPTIONS_H.length - 1]! * 60}
              onClick={() => {
                const longer = SPAN_OPTIONS_H.find((h) => h * 60 > spanMin)
                if (longer !== undefined) onSpan(longer)
              }}
              aria-label={t('map.timeline.zoomOut')}
              title={t('map.timeline.zoomOut')}
              data-testid="timeline-zoom-out"
              className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:text-text disabled:opacity-40"
            >
              <ZoomOut className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}

        {/* FIXED-width slots, right-aligned: the jump set changes with the span (labels and even
            the count), and letting the block reflow resized the flex-1 waveform beside it — the
            founder's "grafikas šokinėja per plotį". The graph must not move when time is re-scaled. */}
        <div className="hidden shrink-0 items-center justify-end gap-1 md:flex md:min-w-[21rem]">
          {quick.map((q) => (
            <button
              key={q.m}
              type="button"
              disabled={disabled}
              onClick={() => {
                setReplaying(false)
                scrub(q.m * 60)
              }}
              aria-pressed={back === q.m * 60}
              data-testid={`timeline-quick-${q.m}`}
              className={cn(
                'w-16 rounded-md py-1 text-center text-[11px] font-medium tabular-nums transition-colors disabled:opacity-40',
                back === q.m * 60 ? 'bg-surface-2 text-accent' : 'text-muted hover:text-text',
              )}
            >
              {q.m === 0
                ? t('map.timeline.now')
                : q.m % 60 === 0
                  ? t('map.timeline.quick.hours', { hours: q.m / 60 })
                  : t('map.timeline.quick.minutes', { minutes: q.m })}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
