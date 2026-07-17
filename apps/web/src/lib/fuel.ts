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

/** Latest fuel value at-or-before tMs (points are chronological). Null before the first
 * sample — the playback overlay shows fuel only once the device has reported it. Pure. */
export function fuelAtTime(points: readonly FuelPoint[], tMs: number): number | null {
  let v: number | null = null
  for (const p of points) {
    if (p.tMs > tMs) break
    v = p.v
  }
  return v
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

/** X coordinate of the playback scrub cursor on the time-scaled fuel chart. Clamped to the
 * series span so scrubbing before the first / after the last sample pins the cursor to the
 * chart edge instead of drawing outside the plot. Null for an empty series. Pure. */
export function fuelCursorX(points: readonly FuelPoint[], tMs: number, w: number, pad: number): number | null {
  if (points.length === 0) return null
  const t0 = points[0]!.tMs
  const span = Math.max(1, points[points.length - 1]!.tMs - t0)
  const clamped = Math.min(Math.max(tMs, t0), t0 + span)
  return pad + (w - pad * 2) * ((clamped - t0) / span)
}
