import { forwardRef, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

// Vendored shadcn/ui input; 15px per spec §1 (forms use text-base).
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-card border border-line bg-surface px-3 py-1 text-[15px] text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
