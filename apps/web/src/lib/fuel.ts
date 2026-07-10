import type { FuelSampleView } from '@orbetra/shared'

import { getJson } from './client'

export type { FuelSampleView }

export const listFuel = (deviceId: string, opts: { from?: string; to?: string; limit?: number } = {}) => {
  const q = new URLSearchParams()
  if (opts.from !== undefined) q.set('from', opts.from)
  if (opts.to !== undefined) q.set('to', opts.to)
  if (opts.limit !== undefined) q.set('limit', String(opts.limit))
  const qs = q.toString()
  return getJson<FuelSampleView[]>(`/v1/devices/${encodeURIComponent(deviceId)}/fuel${qs === '' ? '' : `?${qs}`}`)
}

export interface FuelPoint {
  tMs: number
  v: number
}

/** Pick ONE plottable series from mixed samples (pure). A device reports % (AVL 89/48)
 * and/or liters (AVL 84); percent is preferred when both exist. Samples missing the chosen
 * unit are dropped (not zeroed — a zero would draw a fake fuel-theft dip). Timestamps are
 * KEPT: real devices report fuel sparsely/on-change, so the chart must place points on a
 * time axis — even index spacing would visually attach a fuel dip to the wrong trip moment. */
export function fuelSeries(samples: readonly FuelSampleView[]): { unit: 'pct' | 'l'; points: FuelPoint[] } {
  const hasPct = samples.some((s) => s.pct !== null)
  const unit = hasPct ? 'pct' : 'l'
  const points: FuelPoint[] = []
  for (const s of samples) {
    const v = hasPct ? s.pct : s.liters
    const tMs = Date.parse(s.fixTime)
    if (v !== null && Number.isFinite(tMs)) points.push({ tMs, v })
  }
  return { unit, points }
}

/** Map fuel points → SVG [x,y]: x scaled by TIME within the series span, y by value. Pure. */
export function fuelChartPoints(points: readonly FuelPoint[], w: number, h: number, pad: number): Array<[number, number]> {
  if (points.length === 0) return []
  const t0 = points[0]!.tMs
  const span = Math.max(1, points[points.length - 1]!.tMs - t0)
  const max = Math.max(1, ...points.map((p) => p.v))
  const innerW = w - pad * 2
  const innerH = h - pad * 2
  return points.map((p) => [pad + innerW * ((p.tMs - t0) / span), pad + innerH * (1 - p.v / max)])
}
