import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

// Vendored shadcn/ui skeleton — spec §3: skeletons everywhere, never full-page spinners.
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-card bg-surface-2', className)} {...props} />
}
