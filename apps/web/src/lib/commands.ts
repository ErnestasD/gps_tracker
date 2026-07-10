import { COMMAND_PRESETS, isRetryableCommand } from '@orbetra/shared'

import { getJson, mutate } from './client'

/** Codec-12 command as returned by the API (E08-2). */
export interface CommandView {
  id: string
  deviceId: string
  text: string
  status: string
  response: string | null
  createdAt: string
  sentAt: string | null
  expiresAt: string
}

export { COMMAND_PRESETS }

/** Destructive commands (cpureset/deleterecords) are warning-gated in the UI: the same verbs
 * the dispatcher refuses to auto-retry are the ones an operator must explicitly confirm. */
export const isDestructiveCommand = (text: string): boolean => !isRetryableCommand(text)

const BADGE: Record<string, 'success' | 'danger'> = { acked: 'success', failed: 'danger', expired: 'danger' }
/** Badge variant per command status; unknown statuses render neutral, never throw. */
export const statusVariant = (status: string): 'success' | 'danger' | 'outline' => BADGE[status] ?? 'outline'

/** True while any command is still in flight (queued/sent) — drives history polling. */
export const hasPendingCommand = (commands: readonly { status: string }[]): boolean =>
  commands.some((c) => c.status === 'queued' || c.status === 'sent')

export const listDeviceCommands = (deviceId: string) =>
  getJson<CommandView[]>(`/v1/devices/${encodeURIComponent(deviceId)}/commands`)
export const sendCommand = (deviceId: string, text: string) =>
  mutate<CommandView>('POST', `/v1/devices/${encodeURIComponent(deviceId)}/commands`, { text })
