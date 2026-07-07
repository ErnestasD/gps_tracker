import { useTranslation } from 'react-i18next'

import type { DeviceStatus } from '@/lib/liveStore'
import { cn } from '@/lib/utils'

/**
 * Shared status semantics (DASHBOARD_UI_SPEC §3): online = success + pulse,
 * stale = warn, offline = muted. Never color-only (§6) — label or aria-label
 * always accompanies the dot.
 */
export function StatusDot({ status, withLabel = false }: { status: DeviceStatus; withLabel?: boolean }) {
  const { t } = useTranslation()
  const label = t(`status.${status}`)
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={label} title={label}>
      <span
        data-status={status}
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          status === 'online' && 'animate-pulse bg-success',
          status === 'stale' && 'bg-warn',
          status === 'offline' && 'bg-muted/60',
        )}
      />
      {withLabel && <span className="text-xs text-muted">{label}</span>}
    </span>
  )
}
