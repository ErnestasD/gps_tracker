import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import * as React from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/dist/style.css'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * Date picker (ADR-028 round-2 amendment, ported from orbetra_design_new/admin/DatePicker):
 * Radix Popover + react-day-picker v8 single mode, Monday week start, admin-token styled.
 * Date-only by design (the reference has no time component) — callers derive day bounds.
 * Day buttons get a full `yyyy-MM-dd` aria-label so e2e can click an exact date and screen
 * readers hear the whole date, not just the day number.
 */
export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  ...props
}: {
  value: Date | undefined
  onChange: (d: Date | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  'data-testid'?: string
  'aria-label'?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={disabled === true ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          // data-value mirrors the Combobox trigger contract: assertable current value for e2e
          data-value={value !== undefined ? format(value, 'yyyy-MM-dd') : ''}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          style={{
            borderColor: 'var(--admin-hairline)',
            background: 'var(--admin-surface)',
            color: value !== undefined ? 'var(--admin-ink)' : 'var(--admin-ink-soft)',
          }}
          {...props}
        >
          <CalendarIcon className="h-3.5 w-3.5 opacity-70" aria-hidden />
          <span className="flex-1 truncate text-left">{value !== undefined ? format(value, 'yyyy-MM-dd') : (placeholder ?? t('admin.pickDate'))}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-2" style={{ background: 'var(--admin-surface)', borderColor: 'var(--admin-hairline)' }}>
        <style>{`
          .rdp { --rdp-accent-color: var(--admin-brand); --rdp-background-color: var(--admin-brand-soft); margin: 0; font-size: 13px; }
          .rdp-day_selected, .rdp-day_selected:focus, .rdp-day_selected:hover { background: var(--admin-brand) !important; color: #fff !important; }
          .rdp-day:hover:not([disabled]):not(.rdp-day_selected) { background: var(--admin-brand-soft); color: var(--admin-brand); }
          .rdp-day_today { color: var(--admin-brand); font-weight: 600; }
          .rdp-caption_label, .rdp-head_cell, .rdp-day { color: var(--admin-ink); }
          .rdp-head_cell { color: var(--admin-ink-soft); font-weight: 500; }
          .rdp-nav_button { color: var(--admin-ink); }
          .rdp-nav_button:hover { background: var(--admin-brand-soft); }
        `}</style>
        <DayPicker
          mode="single"
          selected={value}
          onSelect={(d) => {
            onChange(d)
            if (d) setOpen(false)
          }}
          defaultMonth={value}
          weekStartsOn={1}
          showOutsideDays
          // v8.10 day buttons render role="gridcell" with NO aria-label (labels.labelDay is
          // unused there), so the bare day number is ambiguous — e.g. July 1 vs the outside
          // Aug 1 in the same grid. The labelled DayContent span gives every day cell a full
          // yyyy-MM-dd accessible name (descendant aria-label participates in name-from-content).
          components={{
            DayContent: (p) => <span aria-label={format(p.date, 'yyyy-MM-dd')}>{p.date.getDate()}</span>,
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
