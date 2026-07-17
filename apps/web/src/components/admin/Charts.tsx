import type * as React from 'react'

import { areaPath, donutSegments } from '@/lib/dashboard'

/**
 * Hand-rolled SVG charts for the Apžvalga dashboard (ADR-028: no chart runtime dep — the
 * design reference uses recharts; we render the same shapes with plain SVG). All colors are
 * admin/accent tokens so white-label re-theming and both themes apply. Single-series
 * charts carry their identity in the card title (no legend); the donut ships a legend with
 * label + count so identity is never color-alone. Hover = native <title> tooltips.
 */

/** Fixed categorical rotation for donut segments + legend (assigned by sorted index, never
 *  re-painted by filtering). Validated: worst adjacent CVD ΔE 16.6 (accent↔accent-2) ≥ 12. */
export const KIND_COLORS = ['var(--accent)', 'var(--accent-2)', 'var(--success)', 'var(--warn)', 'var(--danger)', 'var(--info)'] as const

export const kindColor = (i: number): string => KIND_COLORS[i % KIND_COLORS.length]!

const W = 640
const H = 240
const ML = 40 // left margin: y tick labels
const MT = 10
const MR = 10
const MB = 22 // bottom margin: x date labels
const PW = W - ML - MR
const PH = H - MT - MB

/** Area chart of a daily km series: smooth line + vertical accent gradient fill, ¼-step y grid,
 *  thinned x date labels, last-point marker, per-day <title> hover columns. */
export function AreaChartSvg({ series, unit, ...props }: { series: { day: string; km: number }[]; unit: string } & React.SVGProps<SVGSVGElement>) {
  const values = series.map((s) => s.km)
  const max = Math.max(...values, 1)
  const { line, area } = areaPath(values, PW, PH)
  const n = series.length
  const labelStep = Math.max(1, Math.ceil(n / 8))
  const x = (i: number): number => (n === 1 ? PW / 2 : (i / (n - 1)) * PW)
  const lastY = PH - (values[n - 1]! / max) * PH
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" {...props}>
      <defs>
        <linearGradient id="dashAreaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* y grid + tick labels at 0/¼/½/¾/max */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const gy = MT + PH - f * PH
        return (
          <g key={f}>
            <line x1={ML} y1={gy} x2={W - MR} y2={gy} stroke="var(--admin-hairline-soft)" strokeWidth={1} />
            <text x={ML - 6} y={gy + 3} textAnchor="end" fontSize={10} fill="var(--admin-ink-soft)">
              {Math.round(max * f)}
            </text>
          </g>
        )
      })}
      <g transform={`translate(${ML},${MT})`}>
        <path d={area} fill="url(#dashAreaFill)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {n > 0 && <circle cx={x(n - 1)} cy={lastY} r={3.5} fill="var(--accent)" stroke="var(--admin-surface)" strokeWidth={2} />}
        {/* hover columns (native tooltips) + thinned date labels */}
        {series.map((s, i) => (
          <g key={s.day}>
            <rect x={x(i) - PW / Math.max(1, n) / 2} y={0} width={PW / Math.max(1, n)} height={PH} fill="transparent">
              <title>{`${s.day} · ${s.km} ${unit}`}</title>
            </rect>
            {i % labelStep === 0 && (
              <text x={x(i)} y={PH + 15} textAnchor="middle" fontSize={9} fill="var(--admin-ink-soft)">
                {s.day.slice(5)}
              </text>
            )}
          </g>
        ))}
      </g>
    </svg>
  )
}

/** Donut of event kinds: stroke-dasharray arcs (2px gaps), center total, colors by KIND_COLORS. */
export function DonutSvg({ breakdown, centerValue, centerLabel, label, ...props }: { breakdown: { kind: string; count: number }[]; centerValue: string; centerLabel: string; label: (kind: string) => string } & React.SVGProps<SVGSVGElement>) {
  const R = 62
  const segments = donutSegments(breakdown, R)
  return (
    <svg viewBox="0 0 168 168" className="mx-auto h-44 w-44" role="img" {...props}>
      <g transform="rotate(-90 84 84)">
        {segments.map((s, i) => (
          <circle key={s.kind} cx={84} cy={84} r={R} fill="none" stroke={kindColor(i)} strokeWidth={20} strokeDasharray={s.dash} strokeDashoffset={s.offset}>
            <title>{`${label(s.kind)} · ${s.count}`}</title>
          </circle>
        ))}
      </g>
      <text x={84} y={82} textAnchor="middle" fontSize={26} fontWeight={600} fill="var(--admin-ink)" className="display">
        {centerValue}
      </text>
      <text x={84} y={100} textAnchor="middle" fontSize={10} fill="var(--admin-ink-soft)">
        {centerLabel}
      </text>
    </svg>
  )
}

const BW = 480
const BH = 150
const BPH = 118 // plot height
const BT = 6 // top margin

/** 24 bars, one per hour of day (00–23): rounded data-ends on the baseline, labels every 3 h. */
export function HourlyBarsSvg({ buckets, unit, ...props }: { buckets: number[]; unit: string } & React.SVGProps<SVGSVGElement>) {
  const max = Math.max(...buckets, 1)
  const base = BT + BPH
  return (
    <svg viewBox={`0 0 ${BW} ${BH}`} className="w-full" role="img" {...props}>
      {[0.5, 1].map((f) => (
        <line key={f} x1={0} y1={base - f * BPH} x2={BW} y2={base - f * BPH} stroke="var(--admin-hairline-soft)" strokeWidth={1} />
      ))}
      <line x1={0} y1={base} x2={BW} y2={base} stroke="var(--admin-hairline)" strokeWidth={1} />
      {buckets.map((v, h) => {
        const bh = v === 0 ? 0 : Math.max(3, (v / max) * BPH)
        return (
          <g key={h}>
            {/* wide transparent hit target behind the thin bar */}
            <rect x={h * 20} y={BT} width={20} height={BPH} fill="transparent">
              <title>{`${String(h).padStart(2, '0')}:00 · ${v} ${unit}`}</title>
            </rect>
            {v > 0 && <rect x={h * 20 + 4} y={base - bh} width={12} height={bh} rx={3} fill="var(--accent)" opacity={0.85} pointerEvents="none" />}
            {h % 3 === 0 && (
              <text x={h * 20 + 10} y={BH - 4} textAnchor="middle" fontSize={9} fill="var(--admin-ink-soft)">
                {String(h).padStart(2, '0')}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
