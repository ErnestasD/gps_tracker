import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Admin design-system primitives (ADR-028), ported from orbetra_design_new. These are the
 * building blocks every re-skinned page composes: PageHeader, AdminButton, Badge (tone-based —
 * distinct from ui/badge's variant API), StatCard(+Sparkline), EmptyState, inputs and toggles.
 * All colors come from the --admin-* tokens (tokens.css) so white-label re-theming applies.
 */

export function PageHeader({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="display text-2xl font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {title}
        </h1>
        {description !== undefined && (
          <p className="mt-1 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>
            {description}
          </p>
        )}
      </div>
      {children !== undefined && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

// forwardRef: SheetTrigger/PopoverTrigger asChild need the underlying <button> node — without
// it Radix's triggerRef stays null and closing a Sheet drops keyboard focus to <body>.
export const AdminButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
  }
>(function AdminButton({ variant = 'primary', size = 'md', className, style: styleOverride, ...props }, ref) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--admin-surface)]'
  const sz = size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm'
  const style: React.CSSProperties =
    variant === 'primary'
      ? { background: 'var(--admin-brand)', color: '#fff', boxShadow: 'var(--admin-shadow-sm)' }
      : variant === 'secondary'
        ? { background: 'var(--admin-surface)', color: 'var(--admin-ink)', border: '1px solid var(--admin-hairline)' }
        : variant === 'danger'
          ? { background: 'var(--admin-danger)', color: '#fff' }
          : { background: 'transparent', color: 'var(--admin-ink)' }
  // default type="button" — these compose inside forms; a bare <button> would submit.
  // Caller style MERGES over the variant style (a bare override used to wipe the whole variant).
  return <button ref={ref} type="button" className={cn(base, sz, className)} style={{ ...style, ...styleOverride }} {...props} />
})

export function Badge({
  tone = 'neutral',
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'
  children: React.ReactNode
}) {
  const styles: Record<string, React.CSSProperties> = {
    neutral: { background: 'var(--admin-surface-sunken)', color: 'var(--admin-ink-soft)', border: '1px solid var(--admin-hairline)' },
    brand: { background: 'var(--admin-brand-soft)', color: 'var(--admin-brand)' },
    success: { background: 'var(--admin-success-soft)', color: 'var(--admin-success)' },
    warning: { background: 'var(--admin-warning-soft)', color: 'var(--admin-warning)' },
    danger: { background: 'var(--admin-danger-soft)', color: 'var(--admin-danger)' },
    info: { background: 'var(--admin-info-soft)', color: 'var(--admin-info)' },
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', className)} style={styles[tone]} {...props}>
      {children}
    </span>
  )
}

export function StatCard({
  label,
  value,
  delta,
  hint,
  spark,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  label: string
  value: React.ReactNode
  delta?: { value: string; tone: 'up' | 'down' | 'flat' }
  hint?: string
  spark?: number[]
}) {
  return (
    <div className="admin-card flex flex-col gap-2 p-3 sm:p-4" {...props}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider sm:text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
          {label}
        </span>
        {delta !== undefined && (
          <Badge tone={delta.tone === 'up' ? 'success' : delta.tone === 'down' ? 'danger' : 'neutral'} className="shrink-0 !text-[10px]">
            {delta.tone === 'up' ? '↑' : delta.tone === 'down' ? '↓' : '→'} {delta.value}
          </Badge>
        )}
      </div>
      <div className="display text-xl font-semibold tracking-tight sm:text-2xl" style={{ color: 'var(--admin-ink)' }}>
        {value}
      </div>
      {(hint !== undefined || spark !== undefined) && (
        <div className="flex items-end justify-between gap-2">
          {hint !== undefined && (
            <span className="min-w-0 text-[11px] sm:text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
              {hint}
            </span>
          )}
          {spark !== undefined && spark.length > 1 && <Sparkline data={spark} />}
        </div>
      )}
    </div>
  )
}

export function Sparkline({ data }: { data: number[] }) {
  const w = 80
  const h = 24
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-6 w-14 shrink-0 sm:w-20" aria-hidden>
      <polyline fill="none" stroke="var(--admin-brand)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center" {...props}>
      {icon !== undefined && (
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-full" style={{ background: 'var(--admin-brand-soft)', color: 'var(--admin-brand)' }}>
          {icon}
        </div>
      )}
      <div className="display text-lg font-semibold" style={{ color: 'var(--admin-ink)' }}>
        {title}
      </div>
      {description !== undefined && (
        <div className="mt-1 max-w-md text-sm" style={{ color: 'var(--admin-ink-soft)' }}>
          {description}
        </div>
      )}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function AdminInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn('h-9 w-full rounded-md border px-3 text-sm outline-none transition-colors placeholder:opacity-60 focus:ring-2 focus:ring-[var(--admin-brand)]/30', className)}
      style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }}
      {...props}
    />
  )
}

export function AdminLabel({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1 block text-xs font-medium', className)} style={{ color: 'var(--admin-ink-soft)' }} {...props} />
}

export function AdminSwitch({
  checked,
  onCheckedChange,
  label,
  disabled,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label?: string
  disabled?: boolean
}) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2', disabled === true && 'opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className="relative h-5 w-9 rounded-full transition-colors"
        style={{ background: checked ? 'var(--admin-brand)' : 'var(--admin-hairline)' }}
        {...props}
      >
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform" style={{ left: checked ? '18px' : '2px' }} />
      </button>
      {label !== undefined && (
        <span className="text-sm" style={{ color: 'var(--admin-ink)' }}>
          {label}
        </span>
      )}
    </label>
  )
}

export function AdminCheckbox({
  checked,
  onCheckedChange,
  label,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label?: string
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className="grid h-4 w-4 place-items-center rounded border transition-colors"
        style={{
          borderColor: checked ? 'var(--admin-brand)' : 'var(--admin-hairline)',
          background: checked ? 'var(--admin-brand)' : 'var(--admin-surface)',
        }}
        {...props}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2,6.5 5,9 10,3.5" />
          </svg>
        )}
      </button>
      {label !== undefined && (
        <span className="text-sm" style={{ color: 'var(--admin-ink)' }}>
          {label}
        </span>
      )}
    </label>
  )
}

export function AdminRadio({
  value,
  onChange,
  options,
  name,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; hint?: string }[]
  name: string
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => {
        const active = o.value === value
        return (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors"
            style={{
              borderColor: active ? 'var(--admin-brand)' : 'var(--admin-hairline)',
              background: active ? 'var(--admin-brand-soft)' : 'var(--admin-surface)',
            }}
          >
            <input type="radio" name={name} value={o.value} checked={active} onChange={() => onChange(o.value)} className="sr-only" />
            <span
              className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border"
              style={{ borderColor: active ? 'var(--admin-brand)' : 'var(--admin-hairline)', background: 'var(--admin-surface)' }}
            >
              {active && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--admin-brand)' }} />}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium" style={{ color: 'var(--admin-ink)' }}>
                {o.label}
              </div>
              {o.hint !== undefined && (
                <div className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                  {o.hint}
                </div>
              )}
            </div>
          </label>
        )
      })}
    </div>
  )
}
