import type { RouteOptimizeRequest, RouteOptimizeResult, RouteStop } from '@orbetra/shared'

import { mutate } from './client'

/** Route optimization client (ADR-029). The API proxies to self-hosted OSRM; 503 = not configured. */
export const optimizeRoute = (req: RouteOptimizeRequest) =>
  mutate<RouteOptimizeResult>('POST', '/v1/routing/optimize', req)

export interface StopsParseError {
  /** 1-based line number in the textarea */
  line: number
  text: string
}
export interface ParsedStops {
  stops: RouteStop[]
  errors: StopsParseError[]
}

/**
 * Parse the planner textarea: one stop per line, `lat,lon[,label]`. Blank lines are
 * skipped; a bad line becomes a per-line error (never thrown). The label may itself
 * contain commas — everything after the second comma is the label. Pure.
 */
export function parseStopsText(text: string): ParsedStops {
  const stops: RouteStop[] = []
  const errors: StopsParseError[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (raw === '') continue
    const parts = raw.split(',')
    const lat = Number(parts[0]?.trim())
    const lon = Number(parts[1]?.trim())
    const label = parts.slice(2).join(',').trim()
    const valid =
      parts.length >= 2 && parts[0]!.trim() !== '' && parts[1]!.trim() !== '' &&
      Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
    if (!valid) {
      errors.push({ line: i + 1, text: raw })
      continue
    }
    stops.push({ lat, lon, ...(label !== '' ? { label: label.slice(0, 120) } : {}) })
  }
  return { stops, errors }
}
