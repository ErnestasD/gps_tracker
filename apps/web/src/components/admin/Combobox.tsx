import { Check, ChevronDown, Search } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type ComboOption = { value: string; label: string; hint?: string }

/** Searchable select (ADR-028, ported from orbetra_design_new; labels i18n-ized). */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  className,
  disabled,
  width,
  ...props
}: {
  value: string | null | undefined
  onChange: (v: string) => void
  options: ComboOption[]
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  disabled?: boolean
  width?: number | string
  'data-testid'?: string
  'aria-label'?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const active = options.find((o) => o.value === value)
  const filtered = q ? options.filter((o) => (o.label + ' ' + (o.hint ?? '')).toLowerCase().includes(q.toLowerCase())) : options

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20)
    else setQ('')
  }, [open])

  return (
    <Popover open={open} onOpenChange={disabled === true ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          // e2e contract: native selects asserted value via toHaveValue; the Combobox trigger
          // exposes the current value as data-value so specs assert it without opening the list
          data-value={value ?? ''}
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          style={{
            borderColor: 'var(--admin-hairline)',
            background: 'var(--admin-surface)',
            color: active !== undefined ? 'var(--admin-ink)' : 'var(--admin-ink-soft)',
            width,
          }}
          {...props}
        >
          <span className="truncate text-left">{active !== undefined ? active.label : (placeholder ?? t('admin.pick'))}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0" style={{ width: 'var(--radix-popover-trigger-width)' }} align="start">
        <div className="admin-hairline-b flex items-center gap-2 px-3 py-2">
          <Search className="h-3.5 w-3.5 opacity-60" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder ?? t('admin.search')}
            className="w-full bg-transparent text-sm outline-none placeholder:opacity-60"
            style={{ color: 'var(--admin-ink)' }}
          />
        </div>
        {/* listbox/option roles: correct picker semantics for AT, and the e2e specs select
            entries via getByRole('option', { name }) — unambiguous while the popover is open */}
        <div className="max-h-64 overflow-y-auto p-1" role="listbox">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>
              {t('admin.nothingFound')}
            </div>
          )}
          {filtered.map((o) => {
            const isActive = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[var(--admin-surface-sunken)]"
                style={{ color: 'var(--admin-ink)', background: isActive ? 'var(--admin-brand-soft)' : 'transparent' }}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint !== undefined && (
                  <span className="text-[11px]" style={{ color: 'var(--admin-ink-soft)' }}>
                    {o.hint}
                  </span>
                )}
                {isActive && <Check className="h-3.5 w-3.5" style={{ color: 'var(--admin-brand)' }} />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
