import * as SheetPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

/**
 * Side drawer on Radix Dialog (ADR-028 round 2), ported from orbetra_design_new/ui/sheet.tsx.
 * Restyled to our tokens (bg-surface + admin hairlines) and, like popover.tsx, the tw-animate-css
 * classes are dropped — a plain transition covers the overlay; the panel appears in place.
 * data-* / aria-* props pass through to the underlying elements (e2e testids).
 */

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close
const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-black/50 transition-opacity', className)} {...props} />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

type Side = 'top' | 'bottom' | 'left' | 'right'

const SIDE_CLASSES: Record<Side, string> = {
  top: 'inset-x-0 top-0 admin-hairline-b',
  bottom: 'inset-x-0 bottom-0 admin-hairline-t',
  left: 'inset-y-0 left-0 h-full w-3/4 admin-hairline-r sm:max-w-sm',
  right: 'inset-y-0 right-0 h-full w-3/4 border-l border-line sm:max-w-sm',
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & { side?: Side }
>(({ side = 'right', className, children, ...props }, ref) => {
  const { t } = useTranslation()
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        className={cn('fixed z-50 flex flex-col gap-4 overflow-y-auto bg-surface p-6 text-text', SIDE_CLASSES[side], className)}
        style={{ boxShadow: 'var(--admin-shadow-md)' }}
        // most sheets have a Title but no Description; an explicit undefined silences Radix's
        // "Missing Description or aria-describedby" console warning (ConfirmDialog precedent).
        // Callers that render a SheetDescription pass their own aria-describedby via props.
        aria-describedby={undefined}
        {...props}
      >
        <SheetPrimitive.Close
          className="absolute right-4 top-4 rounded-sm p-0.5 opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--admin-brand)] disabled:pointer-events-none"
          style={{ color: 'var(--admin-ink)' }}
          aria-label={t('shell.close')}
        >
          <X className="h-4 w-4" aria-hidden />
        </SheetPrimitive.Close>
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
})
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />
)
SheetHeader.displayName = 'SheetHeader'

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
)
SheetFooter.displayName = 'SheetFooter'

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, style, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn('display text-lg font-semibold', className)} style={{ color: 'var(--admin-ink)', ...style }} {...props} />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, style, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn('text-sm', className)} style={{ color: 'var(--admin-ink-soft)', ...style }} {...props} />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export { Sheet, SheetPortal, SheetOverlay, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
