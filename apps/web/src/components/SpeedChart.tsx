import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Hand-rolled SVG speed-vs-sample chart for playback (E04-3). No chart dependency —
 * consistent with the "draw at runtime, no binary assets" ethos. Click/drag scrubs;
 * a cursor line marks the current sample. `chartPoints` is pure (unit-tested).
 */
const W = 600
const H = 120
const PAD = 6

/** Map speeds → SVG [x,y] points. y is inverted (0 at bottom). Pure. */
export function chartPoints(speeds: readonly number[], w = W, h = H, pad = PAD): Array<[number, number]> {
  if (speeds.length === 0) return []
  const max = Math.max(1, ...speeds)
  const innerW = w - pad * 2
  const innerH = h - pad * 2
  const step = speeds.length > 1 ? innerW / (speeds.length - 1) : 0
  return speeds.map((s, i) => [pad + i * step, pad + innerH * (1 - s / max)])
}

export function SpeedChart({ speeds, index, onScrub }: { speeds: number[]; index: number; onScrub: (i: number) => void }) {
  const { t } = useTranslation()
  const ref = useRef<SVGSVGElement>(null)
  const pts = useMemo(() => chartPoints(speeds), [speeds])
  const path = pts.length > 0 ? 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L') : ''
  const cursorX = pts[index]?.[0] ?? PAD

  const scrubToClientX = (clientX: number) => {
    const svg = ref.current
    if (svg === null || speeds.length === 0) return
    const rect = svg.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onScrub(Math.round(ratio * (speeds.length - 1)))
  }

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      className="h-28 w-full cursor-crosshair select-none rounded-card border border-line bg-surface"
      role="slider"
      aria-label={t('charts.speedTimeline')}
      aria-valuenow={index}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, speeds.length - 1)}
      data-testid="speed-chart"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        scrubToClientX(e.clientX)
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) scrubToClientX(e.clientX)
      }}
    >
      {path !== '' && <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
      <line x1={cursorX} y1={PAD} x2={cursorX} y2={H - PAD} stroke="var(--accent-2, #7c5cfc)" strokeWidth={1} data-testid="speed-cursor" />
    </svg>
  )
}
