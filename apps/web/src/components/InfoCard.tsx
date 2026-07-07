import { Crosshair, Route, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusDot } from '@/components/ui-x/StatusDot'
import type { DeviceLive } from '@/lib/liveStore'
import { cn } from '@/lib/utils'

/** Relative time for Live contexts only (spec §3 time rule); Intl, no date math. */
function relTime(fixTimeMs: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const deltaS = Math.round((fixTimeMs - Date.now()) / 1_000)
  if (deltaS > -60) return rtf.format(deltaS, 'second')
  if (deltaS > -3_600) return rtf.format(Math.round(deltaS / 60), 'minute')
  return rtf.format(Math.round(deltaS / 3_600), 'hour')
}

/** Bottom-left selected-device card (spec §4: Cloudflare-style info card). */
export function InfoCard({
  device,
  follow,
  trail,
  onFollow,
  onTrail,
  onClose,
}: {
  device: DeviceLive
  follow: boolean
  trail: boolean
  onFollow: (v: boolean) => void
  onTrail: (v: boolean) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const { ev, status } = device
  return (
    <Card data-testid="info-card" className="absolute bottom-4 left-[352px] z-10 w-72 bg-surface/95 backdrop-blur">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <StatusDot status={status} />
          {ev.deviceId}
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label={t('info.close')}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted">{t('info.speed')}</dt>
            <dd className="tabular-nums text-text">
              {ev.speed ?? 0} {t('units.kmh')}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{t('info.ignition')}</dt>
            <dd className="text-text">{ev.ignition === null ? '—' : ev.ignition ? t('info.on') : t('info.off')}</dd>
          </div>
          <div>
            <dt className="text-muted">{t('info.satellites')}</dt>
            <dd className="tabular-nums text-text">{ev.satellites}</dd>
          </div>
        </dl>
        <div className="flex items-center gap-2">
          {!ev.fixValid && <Badge variant="warn">{t('info.invalidFix')}</Badge>}
          <span className="text-[11px] text-muted">{relTime(ev.fixTimeMs, i18n.language)}</span>
        </div>
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
            <Route className="h-3.5 w-3.5" aria-hidden />
            {t('info.trail')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
