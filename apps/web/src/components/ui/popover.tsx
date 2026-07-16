import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as React from 'react'

import { cn } from '@/lib/utils'

/** Vendored shadcn popover (ADR-028) — animation classes dropped (no tw-animate-css dep);
 * surfaces read the admin tokens so portalled content matches the theme. */
const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, style, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn('z-50 w-72 rounded-md border border-line bg-surface p-4 text-text outline-none', className)}
      style={{ boxShadow: 'var(--admin-shadow-md)', ...style }}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
