import { useQuery } from '@tanstack/react-query'
import { Clock, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useFmt } from '@/lib/datetime'
import { drawable, getTrack, pointAt } from '@/lib/telemetry'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'

/**
 * The selected device's last 24 hours, scrubbable (founder request 2026-08-18, Lovable design).
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
 */
export function Timeline({
  deviceId,
  name,
  onScrub,
  onClose,
}: {
  deviceId: string
  name: string
  /** null ⇒ back to live. The map draws the historic position when a moment is selected. */
  onScrub: (point: { lat: number; lon: number; course: number | null } | null) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const { speed } = useUnits()
  const q = useQuery({ queryKey: ['track', deviceId], queryFn: () => getTrack(deviceId, 24) })
  /** Minutes back from now: 0 is live. */
  const [back, setBack] = useState(0)

  const points = useMemo(() => q.data ?? [], [q.data])
  const span = useMemo(() => {
    const now = Date.now()
    return { from: now - 24 * 3_600_000, to: now }
  }, [q.data])

  const atMs = span.to - back * 60_000
  const current = back === 0 ? undefined : pointAt(points, atMs)

  const scrub = (minutes: number) => {
    setBack(minutes)
    if (minutes === 0) {
      onScrub(null)
      return
    }
    const p = pointAt(points, span.to - minutes * 60_000)
    // an invalid fix is a real state but not a place — never move the map to one
    onScrub(p !== undefined && p.fixValid ? { lat: p.lat, lon: p.lon, course: p.course } : null)
  }

  const valid = drawable(points)

  return (
    <div
      className="pointer-events-auto absolute inset-x-2 bottom-2 z-10 rounded-card border border-line bg-surface/95 p-2 shadow-card backdrop-blur lg:inset-x-4"
      data-testid="timeline"
    >
      <div className="flex items-center gap-2 text-xs">
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
        <span className="truncate font-medium text-text">{name}</span>
        <span className="shrink-0 text-muted">
          {q.isLoading
            ? t('admin.loading')
            : t('map.timeline.summary', { points: points.length, valid: valid.length })}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('info.close')}
          data-testid="timeline-close"
          className="ml-auto shrink-0 rounded p-1 text-muted transition-colors hover:text-text"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={24 * 60}
        step={1}
        // the slider runs right-to-left in time: 0 (right) is now, 1440 (left) is 24 h ago
        value={24 * 60 - back}
        onChange={(e) => scrub(24 * 60 - Number(e.currentTarget.value))}
        aria-label={t('map.timeline.scrub')}
        data-testid="timeline-scrub"
        className="mt-1.5 w-full accent-[var(--admin-brand)]"
        disabled={points.length === 0}
      />

      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>{t('map.timeline.hoursAgo', { hours: 24 })}</span>
        <span className={cn('tabular-nums', back === 0 && 'text-accent')} data-testid="timeline-at">
          {back === 0
            ? t('map.timeline.now')
            : current === undefined
              ? t('map.timeline.noData', { when: dt(new Date(atMs).toISOString()) })
              : `${dt(current.fixTime)} · ${current.fixValid ? speed(current.speed ?? 0) : t('map.timeline.noFix')}`}
        </span>
        <span>{t('map.timeline.now')}</span>
      </div>
    </div>
  )
}
