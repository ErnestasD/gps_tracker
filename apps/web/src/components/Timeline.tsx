import { Pause, Play, Route as RouteIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useFmt } from '@/lib/datetime'
import { pointAt, type TrackPoint } from '@/lib/telemetry'
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
const SPAN_MIN = 24 * 60
/** Replay speed: 6 minutes of history per 90 ms tick ⇒ a full day in ~3.6 s. */
const REPLAY_STEP_MIN = 6
const REPLAY_TICK_MS = 90

const QUICK: { m: number; key: string }[] = [
  { m: 1440, key: 'map.timeline.quick.h24' },
  { m: 720, key: 'map.timeline.quick.h12' },
  { m: 360, key: 'map.timeline.quick.h6' },
  { m: 60, key: 'map.timeline.quick.h1' },
  { m: 0, key: 'map.timeline.now' },
]

export function Timeline({
  deviceId,
  name,
  points,
  loading,
  truncated,
  onScrub,
}: {
  /** null ⇒ nothing selected: the bar stays, disabled, rather than vanishing. */
  deviceId: string | null
  name: string | null
  points: readonly TrackPoint[]
  loading: boolean
  truncated: boolean
  /** null ⇒ back to live. The map draws the historic position when a moment is selected. */
  onScrub: (point: { lat: number; lon: number; course: number | null } | null) => void
}) {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const { speed } = useUnits()
  /** Minutes back from now: 0 is live. */
  const [back, setBack] = useState(0)
  const [replaying, setReplaying] = useState(false)

  /**
   * The window is frozen per device, NOT recomputed from the data.
   *
   * Memoising it on the query result moved the moment under the operator: this app's query client
   * refetches on window focus, so alt-tabbing away and back shifted `to` forward by however long
   * they were gone, while the thumb and the map stayed put — the readout then named a different
   * moment than the position on screen.
   */
  const [span, setSpan] = useState(() => ({ id: deviceId, to: Date.now() }))
  if (span.id !== deviceId) {
    setSpan({ id: deviceId, to: Date.now() })
    setBack(0)
    setReplaying(false)
  }

  const atMs = span.to - back * 60_000
  const current = back === 0 ? undefined : pointAt(points, atMs)
  const disabled = deviceId === null || points.length === 0

  const scrub = (minutes: number) => {
    setBack(minutes)
    if (minutes === 0) {
      onScrub(null)
      return
    }
    /**
     * An invalid fix is a real state but not a place, so the map must not move to it — and it must
     * not fall back to LIVE either. Passing null there put the camera on the vehicle's present
     * position while the readout named a past moment with no fix, which is a worse lie than showing
     * nothing. Per spec §3.4 a no-fix record repeats the last valid position, so the camera holds
     * at the last place the vehicle was actually seen before that moment.
     */
    const at = span.to - minutes * 60_000
    let place: TrackPoint | undefined
    for (const p of points) {
      if (Date.parse(p.fixTime) > at) break
      if (p.fixValid) place = p
    }
    onScrub(place !== undefined ? { lat: place.lat, lon: place.lon, course: place.course } : null)
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
  backRef.current = back
  const scrubRef = useRef(scrub)
  scrubRef.current = scrub
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

  // A device with no history cannot be replayed; leaving `replaying` set would spin an interval
  // that scrubs to nothing forever.
  useEffect(() => {
    if (disabled) setReplaying(false)
  }, [disabled])

  const pct = ((SPAN_MIN - back) / SPAN_MIN) * 100
  const stamp = dt(new Date(atMs).toISOString())
  const valid = points.filter((p) => p.fixValid).length

  return (
    <div
      className="shrink-0 border-t border-line bg-surface px-3 py-2 md:px-4"
      data-testid="timeline"
    >
      <div className="flex items-center gap-2 md:gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (replaying) {
              setReplaying(false)
              return
            }
            if (back === 0) scrub(SPAN_MIN)
            setReplaying(true)
          }}
          aria-pressed={replaying}
          aria-label={t(replaying ? 'map.timeline.stopReplay' : 'map.timeline.replay')}
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
                    : current.fixValid
                      ? speed(current.speed ?? 0)
                      : t('map.timeline.noFix')}
                </span>
              )}
            </span>
            <span className="hidden shrink-0 text-[11px] text-muted sm:inline" data-testid="timeline-summary">
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
              max={SPAN_MIN}
              step={1}
              // the slider runs right-to-left in time: 0 (right) is now, 1440 (left) is 24 h ago
              value={SPAN_MIN - back}
              onChange={(e) => {
                setReplaying(false)
                scrub(SPAN_MIN - Number(e.currentTarget.value))
              }}
              aria-label={t('map.timeline.scrub')}
              data-testid="timeline-scrub"
              disabled={disabled}
              className="absolute inset-0 h-1.5 w-full cursor-pointer appearance-none bg-transparent accent-[var(--admin-brand)] disabled:cursor-not-allowed"
            />
          </div>

          <div className="mt-1 hidden justify-between text-[10px] text-muted sm:flex">
            <span>{t('map.timeline.hoursAgo', { hours: 24 })}</span>
            <span>{t('map.timeline.hoursAgo', { hours: 18 })}</span>
            <span>{t('map.timeline.hoursAgo', { hours: 12 })}</span>
            <span>{t('map.timeline.hoursAgo', { hours: 6 })}</span>
            <span>{t('map.timeline.now')}</span>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-1 md:flex">
          {QUICK.map((q) => (
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
              {t(q.key, { hours: q.m / 60 })}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
