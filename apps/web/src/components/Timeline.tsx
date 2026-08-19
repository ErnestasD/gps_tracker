import { Pause, Play, Route as RouteIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useFmt } from '@/lib/datetime'
import type { ScrubState } from '@/lib/liveStore'
import { placeAt, pointAt, type TrackPoint } from '@/lib/telemetry'
import { canScrub, firstPlaceBack, quickJumps, spanMinutes, type TrackWindow } from '@/lib/trackWindow'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'

/**
 * The selected device's last 24 hours, scrubbable, docked under the map (founder design).
 *
 * Built entirely from data the platform already stores: the positions endpoint the playback page
 * uses, over a 24-hour window. Nothing here is simulated — the design's version wandered devices
 * around with a sine function, which is fine for a mockup and unusable in a product where an
 * operator will take what they see as evidence.
 *
 * Two rules it inherits:
 *  - an invalid fix never places anything on the map (invariant I6), but it is still SHOWN on the
 *    timeline as a no-fix stretch, because "reporting without a fix" and "not reporting" are
 *    different answers to "where was the truck at 14:30".
 *  - the scrubber reports the newest point at or before the moment, never the nearest: a track is a
 *    sequence of states, and at 14:32 the vehicle was where it last reported.
 *
 * It is a fixture of the workspace rather than a popup, because a bar that appears only after two
 * clicks is a bar nobody finds. With no vehicle selected it says so and does nothing — the history
 * we hold is per device, and pretending otherwise would mean replaying a fleet we never queried.
 */
/** Replay speed: 6 minutes of history per 90 ms tick ⇒ a full day in ~3.6 s. */
const REPLAY_STEP_MIN = 6
const REPLAY_TICK_MS = 90


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
   * "-24 h" tick meant a different moment than the earliest row we held, and nudging the slider one
   * minute off "now" jumped the map by however long the tab had been in the background.
   */
  window: TrackWindow
  loading: boolean
  /** The points are the PREVIOUS window's, still being refreshed — usable, but say so. */
  stale?: boolean
  truncated: boolean
  /** null ⇒ back to live, 'unknown' ⇒ a moment we hold no position for: hold, never fall back. */
  onScrub: (point: ScrubState) => void
}) {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const { speed } = useUnits()
  /** Minutes back from now: 0 is live. */
  const [back, setBack] = useState(0)
  const [replaying, setReplaying] = useState(false)

  // A new vehicle starts at "now", never at whatever moment the previous one was parked on.
  const [lastId, setLastId] = useState(deviceId)
  if (lastId !== deviceId) {
    setLastId(deviceId)
    setBack(0)
    setReplaying(false)
  }

  const spanMin = spanMinutes(window)
  const firstBack = useMemo(() => firstPlaceBack(points, window, times), [points, window, times])
  const atMs = window.to - back * 60_000
  const current = useMemo(() => (back === 0 ? undefined : pointAt(points, atMs, times)), [points, times, atMs, back])
  const disabled = deviceId === null || points.length === 0 || !canScrub(firstBack)

  const scrub = (rawMinutes: number) => {
    // clamped, so no caller can name a moment outside the window the points were fetched for
    const minutes = Math.min(spanMin, Math.max(0, rawMinutes))
    setBack(minutes)
    if (minutes === 0) {
      onScrub(null)
      return
    }
    /**
     * An invalid fix is a real state but not a place, so the map must not move to it — and it must
     * not fall back to LIVE either. Passing null there put the camera on the vehicle's present
     * position while the readout named a past moment with no fix, which is a worse lie than showing
     * nothing — and it fired on EVERY press of "-24 h", because the earliest row we hold is always
     * later than the window's own start. Per spec §3.4 a no-fix record repeats the last valid
     * position, so the camera holds at the last place the vehicle was actually seen; before the
     * first one there is nowhere to hold, and 'unknown' says exactly that.
     */
    const place = placeAt(points, window.to - minutes * 60_000, times)
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
  useLayoutEffect(() => {
    backRef.current = back
    scrubRef.current = scrub
  })
  useEffect(() => {
    if (!replaying) return
    const iv = setInterval(() => {
      const next = backRef.current - REPLAY_STEP_MIN
      if (next <= 0) {
        setReplaying(false)
        scrubRef.current(0)
        return
      }
      scrubRef.current(next)
    }, REPLAY_TICK_MS)
    return () => clearInterval(iv)
  }, [replaying])

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
  const pct = ((spanMin - back) / spanMin) * 100
  const stamp = dt(new Date(atMs).toISOString())
  // O(n) over up to 10 000 points, and this component re-renders at the store's 1 Hz cadence
  const valid = useMemo(() => points.filter((p) => p.fixValid).length, [points])

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
            if (back === 0 && canScrub(firstBack)) scrub(firstBack)
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

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
              <RouteIcon className="h-3 w-3 shrink-0" aria-hidden />
              <span
                className={cn('shrink-0 tabular-nums', back === 0 ? 'text-text' : 'text-warn')}
                data-testid="timeline-at"
              >
                {back === 0 ? t('map.timeline.now') : stamp}
              </span>
              {back > 0 && (
                <span className="truncate">
                  ·{' '}
                  {current === undefined
                    ? t('map.timeline.noData', { when: stamp })
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

          <div className="relative">
            <div className="h-1.5 w-full rounded-full bg-surface-2" />
            <div
              className={cn('pointer-events-none absolute inset-y-0 left-0 h-1.5 rounded-full', back === 0 ? 'bg-accent' : 'bg-warn')}
              style={{ width: `${pct}%` }}
            />
            <input
              type="range"
              min={0}
              max={spanMin}
              step={1}
              // reversed: the range's own value counts UP toward now, while `back` counts minutes
              // backwards from it — so value 0 (left) is the start of the window and `spanMin`
              // (right) is now
              value={spanMin - back}
              onChange={(e) => {
                setReplaying(false)
                scrub(spanMin - Number(e.currentTarget.value))
              }}
              aria-label={t('map.timeline.scrub', { hours: Math.round(spanMin / 60) })}
              data-testid="timeline-scrub"
              disabled={disabled}
              className="absolute inset-0 h-1.5 w-full cursor-pointer appearance-none bg-transparent accent-[var(--admin-brand)] disabled:cursor-not-allowed"
            />
          </div>

          <div className="mt-1 hidden justify-between text-[10px] text-muted sm:flex">
            {[1, 0.75, 0.5, 0.25].map((f) => (
              <span key={f}>{t('map.timeline.hoursAgo', { hours: Math.round((spanMin / 60) * f) })}</span>
            ))}
            <span>{t('map.timeline.now')}</span>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-1 md:flex">
          {quick.map((q) => (
            <button
              key={q.m}
              type="button"
              disabled={disabled}
              onClick={() => {
                setReplaying(false)
                scrub(q.m)
              }}
              aria-pressed={back === q.m}
              data-testid={`timeline-quick-${q.m}`}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40',
                back === q.m ? 'bg-surface-2 text-accent' : 'text-muted hover:text-text',
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
