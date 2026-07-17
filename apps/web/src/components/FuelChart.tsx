import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/admin/AdminKit'
import { fuelChartPoints, fuelCursorX, type FuelPoint } from '@/lib/fuel'
import { useUnits } from '@/lib/units'

/**
 * Fuel-level line for playback (E08-3). Same hand-rolled SVG approach as SpeedChart
 * (no chart dependency); display-only — §4 draws the hard line at fuel-THEFT detection.
 * Render it only when a series exists ("where AVL present"). X is scaled by TIME (real
 * devices report fuel sparsely — index spacing would misplace dips against the trip).
 * Mirrors SpeedChart's scrub treatment (verify-sweep): `cursorMs` draws the current-position
 * line and `value` (the page's fuelAtTime at the scrub position) drives the badge — falling
 * back to the series' last value before the first sample so the badge never goes blank.
 */
const W = 600
const H = 80
const PAD = 6

export function FuelChart({
  points,
  unit,
  cursorMs,
  value,
}: {
  points: FuelPoint[]
  unit: 'pct' | 'l'
  /** scrub position (ms epoch of the current playback sample) — omits the cursor when absent */
  cursorMs?: number
  /** fuel level at the scrub position (fuelAtTime); null before the first sample */
  value?: number | null
}) {
  const { t } = useTranslation()
  const { volumeL } = useUnits()
  const pts = useMemo(() => fuelChartPoints(points, W, H, PAD), [points])
  const path = pts.length > 0 ? 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L') : ''
  const shown = value ?? points[points.length - 1]?.v
  const cursorX = cursorMs !== undefined ? fuelCursorX(points, cursorMs, W, PAD) : null

  return (
    <div className="space-y-1" data-testid="fuel-chart">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span style={{ color: 'var(--admin-ink-soft)' }}>{t('playback.fuel')}</span>
        {shown !== undefined && (
          <Badge tone="brand" data-testid="fuel-last">
            {/* percentages stay % — only litre readings convert to the volume pref */}
            <span className="tabular-nums">{unit === 'pct' ? `${shown}%` : volumeL(shown)}</span>
          </Badge>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full select-none rounded-card border border-line bg-surface" role="img" aria-label="fuel level timeline">
        {path !== '' && <path d={path} fill="none" stroke="var(--accent-2, #7c5cfc)" strokeWidth={1.5} />}
        {cursorX !== null && <line x1={cursorX} y1={PAD} x2={cursorX} y2={H - PAD} stroke="var(--accent)" strokeWidth={1} data-testid="fuel-cursor" />}
      </svg>
    </div>
  )
}
