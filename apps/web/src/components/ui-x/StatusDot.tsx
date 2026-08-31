import { useTranslation } from 'react-i18next'

import { useFmt } from '@/lib/datetime'
import type { DeviceStatus } from '@/lib/liveStore'
import { cn } from '@/lib/utils'

/**
 * Shared status semantics (DASHBOARD_UI_SPEC §3): online = success + pulse,
 * stale = warn, offline = muted. Never color-only (§6) — label or aria-label
 * always accompanies the dot.
 */
export function StatusDot({
  status,
  withLabel = false,
  className,
  lastSeenMs,
}: {
  status: DeviceStatus
  withLabel?: boolean
  className?: string
  /** epoch ms of the last report — appended to the tooltip, because "Offline" alone does not say
   *  whether the vehicle went quiet four minutes ago or last Tuesday. */
  lastSeenMs?: number
}) {
  const { t } = useTranslation()
  const { ago } = useFmt()
  const state = t(`status.${status}`)
  const label = lastSeenMs === undefined ? state : `${state} · ${ago(lastSeenMs)}`
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} aria-label={label} title={label}>
      <span
        data-status={status}
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          status === 'online' && 'animate-pulse bg-success',
          status === 'stale' && 'bg-warn',
          status === 'offline' && 'bg-muted/60',
        )}
      />
      {withLabel && <span className="text-xs text-muted">{state}</span>}
    </span>
  )
}
