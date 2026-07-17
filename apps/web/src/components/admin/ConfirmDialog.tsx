import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton } from '@/components/admin/AdminKit'

/**
 * Confirmation modal (ADR-028 round 2) on Radix Dialog: focus-trapped, Esc/overlay-click cancel.
 * Replaces window.confirm-style flows for destructive actions. Labels default to the
 * admin.confirm/admin.cancel/admin.confirmTitle catalog entries.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'default',
  onConfirm,
  confirmTestId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  confirmLabel?: string
  tone?: 'danger' | 'default'
  onConfirm: () => void
  confirmTestId?: string
}) {
  const { t } = useTranslation()
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 transition-opacity" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 text-text outline-none"
          style={{ boxShadow: 'var(--admin-shadow-md)' }}
          // Radix warns without a Description; the description is optional here by design
          aria-describedby={description !== undefined ? undefined : ''}
          data-testid="confirm-dialog"
        >
          <DialogPrimitive.Title className="display text-base font-semibold" style={{ color: 'var(--admin-ink)' }}>
            {title ?? t('admin.confirmTitle')}
          </DialogPrimitive.Title>
          {description !== undefined && (
            <DialogPrimitive.Description className="mt-1.5 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>
              {description}
            </DialogPrimitive.Description>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AdminButton variant="secondary" onClick={() => onOpenChange(false)} data-testid="confirm-cancel">
              {t('admin.cancel')}
            </AdminButton>
            <AdminButton
              variant={tone === 'danger' ? 'danger' : 'primary'}
              onClick={() => {
                onConfirm()
                onOpenChange(false)
              }}
              data-testid={confirmTestId ?? 'confirm-ok'}
            >
              {confirmLabel ?? t('admin.confirm')}
            </AdminButton>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export interface ConfirmOptions {
  title?: string
  description?: string
  confirmLabel?: string
  tone?: 'danger' | 'default'
  confirmTestId?: string
}

/**
 * Promise-flavoured confirm for imperative call sites:
 *   const { confirm, element } = useConfirm()
 *   … if (await confirm({ tone: 'danger', description: t('x.sure') })) doIt()
 * Render {element} once anywhere in the page. Cancel/Esc/overlay resolve false.
 */
export function useConfirm(): { confirm: (opts?: ConfirmOptions) => Promise<boolean>; element: React.ReactNode } {
  const [pending, setPending] = React.useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null)

  const confirm = React.useCallback(
    (opts: ConfirmOptions = {}) =>
      new Promise<boolean>((resolve) => {
        setPending({ opts, resolve })
      }),
    [],
  )

  const settle = (v: boolean) => {
    // double-settles are harmless (onConfirm fires before onOpenChange(false)) — a promise
    // resolves once; we only need to clear the mounted dialog
    pending?.resolve(v)
    setPending(null)
  }

  const element =
    pending === null ? null : (
      <ConfirmDialog
        open
        onOpenChange={(o) => {
          if (!o) settle(false)
        }}
        onConfirm={() => settle(true)}
        {...pending.opts}
      />
    )

  return { confirm, element }
}
