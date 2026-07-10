import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { fuelChartPoints, type FuelPoint } from '@/lib/fuel'

/**
 * Fuel-level line for playback (E08-3). Same hand-rolled SVG approach as SpeedChart
 * (no chart dependency); display-only — §4 draws the hard line at fuel-THEFT detection.
 * Render it only when a series exists ("where AVL present"). X is scaled by TIME (real
 * devices report fuel sparsely — index spacing would misplace dips against the trip).
 */
const W = 600
const H = 80
const PAD = 6

export function FuelChart({ points, unit }: { points: FuelPoint[]; unit: 'pct' | 'l' }) {
  const { t } = useTranslation()
  const pts = useMemo(() => fuelChartPoints(points, W, H, PAD), [points])
  const path = pts.length > 0 ? 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L') : ''
  const last = points[points.length - 1]?.v

  return (
    <div className="space-y-1" data-testid="fuel-chart">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>{t('playback.fuel')}</span>
        {last !== undefined && (
          <span className="tabular-nums" data-testid="fuel-last">
            {unit === 'pct' ? `${last}%` : t('playback.fuelLiters', { l: last.toFixed(1) })}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full select-none rounded-card border border-line bg-surface" role="img" aria-label="fuel level timeline">
        {path !== '' && <path d={path} fill="none" stroke="var(--accent-2, #7c5cfc)" strokeWidth={1.5} />}
      </svg>
    </div>
  )
}
