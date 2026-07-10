import { getJson, mutate, request } from './client'

/** GDPR client (E08-4): device erase + account data export. */

export interface ExportJob {
  id: string
  accountId: string
  status: string // pending | done | failed
  sizeBytes: string | null
  error: string | null
  createdAt: string
  expiresAt: string
}

export const eraseDevice = (deviceId: string) =>
  mutate<{ queued: boolean }>('POST', `/v1/devices/${encodeURIComponent(deviceId)}/erase`)
export const requestExport = (accountId: string) =>
  mutate<ExportJob>('POST', `/v1/accounts/${encodeURIComponent(accountId)}/export`)
export const listExports = () => getJson<ExportJob[]>('/v1/exports')

/** Download needs the bearer header, so a plain <a href> cannot work — fetch → blob → save. */
export async function downloadExport(id: string): Promise<void> {
  const res = await request('GET', `/v1/exports/${encodeURIComponent(id)}/download`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `orbetra-export-${id}.ndjson.gz`
  a.click()
  URL.revokeObjectURL(url)
}

/** True while a poll is warranted (mirrors commands' hasPendingCommand). */
export const hasPendingExport = (jobs: readonly { status: string }[]): boolean =>
  jobs.some((j) => j.status === 'pending')
