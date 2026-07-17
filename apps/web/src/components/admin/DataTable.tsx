import { ArrowDown, ArrowUp, ChevronsUpDown, Search, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Combobox } from '@/components/admin/Combobox'
import { cn } from '@/lib/utils'

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  sortable?: boolean
  sortValue?: (row: T) => string | number
  filterOptions?: { label: string; value: string }[]
  filterValue?: (row: T) => string
  className?: string
  align?: 'left' | 'right' | 'center'
  hideOnMobile?: boolean
}

/** md-breakpoint mirror: the table renders EITHER the desktop layout OR the mobile cards.
 * Rendering both (CSS-hidden) would duplicate every per-row control/testid in the DOM —
 * Playwright strict mode and screen readers both see the hidden copy. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = React.useState<boolean>(
    () => typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 768px)').matches,
  )
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = (e: MediaQueryListEvent) => setDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return desktop
}

/**
 * Client-side data table (ADR-028, ported from orbetra_design_new; labels i18n-ized):
 * free-text search, per-column dropdown filters, single-column sort, pagination, and a
 * stacked mobile card layout (one layout at a time, see useIsDesktop). For cursor-paginated
 * server data (events/audit) keep the page's own table + load-more — this component is for
 * fully-loaded lists.
 */
export function DataTable<T extends { id: string }>({
  data,
  columns,
  searchable = true,
  searchKeys,
  pageSize = 10,
  emptyLabel,
  rowAction,
  toolbarLeft,
  toolbarRight,
  rowTestId,
  ...props
}: {
  data: T[]
  columns: Column<T>[]
  searchable?: boolean
  searchKeys?: (keyof T)[]
  pageSize?: number
  emptyLabel?: string
  rowAction?: (row: T) => React.ReactNode
  toolbarLeft?: React.ReactNode
  toolbarRight?: React.ReactNode
  /** per-row data-testid factory (e2e contract, e.g. row => `device-${row.imei}`) */
  rowTestId?: (row: T) => string
  'data-testid'?: string
}) {
  const { t } = useTranslation()
  const isDesktop = useIsDesktop()
  const [q, setQ] = React.useState('')
  const [sort, setSort] = React.useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  const [filters, setFilters] = React.useState<Record<string, string>>({})
  const [page, setPage] = React.useState(0)

  const filtered = React.useMemo(() => {
    let out = data
    if (q && searchable) {
      const l = q.toLowerCase()
      out = out.filter((row) => {
        if (searchKeys !== undefined && searchKeys.length > 0) {
          return searchKeys.some((k) => String(row[k] ?? '').toLowerCase().includes(l))
        }
        // only primitive fields participate in the all-values search (objects stringify uselessly)
        return Object.values(row as Record<string, unknown>).some(
          (v) => (typeof v === 'string' || typeof v === 'number') && String(v).toLowerCase().includes(l),
        )
      })
    }
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue
      const col = columns.find((c) => c.key === key)
      if (col?.filterValue === undefined) continue
      out = out.filter((r) => col.filterValue!(r) === val)
    }
    if (sort !== null) {
      const col = columns.find((c) => c.key === sort.key)
      if (col?.sortValue !== undefined) {
        out = [...out].sort((a, b) => {
          const va = col.sortValue!(a)
          const vb = col.sortValue!(b)
          if (va < vb) return sort.dir === 'asc' ? -1 : 1
          if (va > vb) return sort.dir === 'asc' ? 1 : -1
          return 0
        })
      }
    }
    return out
  }, [data, q, searchable, searchKeys, filters, sort, columns])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  React.useEffect(() => {
    if (page >= pageCount) setPage(0)
  }, [page, pageCount])
  const paged = filtered.slice(page * pageSize, page * pageSize + pageSize)

  const filterableCols = columns.filter((c) => (c.filterOptions?.length ?? 0) > 0)
  const anyFilterActive = Object.values(filters).some(Boolean) || q !== ''
  const empty = emptyLabel ?? t('admin.empty')

  return (
    <div className="admin-card overflow-hidden" {...props}>
      <div className="admin-hairline-b flex flex-wrap items-center gap-2 p-3">
        {searchable && (
          <div
            className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-md border px-3 text-sm"
            style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface-sunken)' }}
          >
            <Search className="h-3.5 w-3.5 opacity-60" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(0)
              }}
              placeholder={t('admin.search')}
              className="w-full bg-transparent outline-none placeholder:opacity-60"
              style={{ color: 'var(--admin-ink)' }}
            />
            {q !== '' && (
              <button type="button" onClick={() => setQ('')} aria-label={t('admin.clear')}>
                <X className="h-3.5 w-3.5 opacity-60" />
              </button>
            )}
          </div>
        )}
        {toolbarLeft}
        <div className="flex-1" />
        {filterableCols.map((col) => (
          <div key={col.key} className="w-44">
            <Combobox
              value={filters[col.key] ?? ''}
              onChange={(v) => {
                setFilters((f) => ({ ...f, [col.key]: v }))
                setPage(0)
              }}
              options={[{ value: '', label: t('admin.allOf', { header: col.header }) }, ...col.filterOptions!]}
              placeholder={t('admin.allOf', { header: col.header })}
            />
          </div>
        ))}
        {anyFilterActive && (
          <button
            type="button"
            onClick={() => {
              setFilters({})
              setQ('')
            }}
            className="h-9 rounded-md border px-3 text-sm"
            style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink-soft)' }}
          >
            {t('admin.clear')}
          </button>
        )}
        {toolbarRight}
      </div>

      {/* desktop table */}
      {isDesktop && (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--admin-surface-sunken)' }}>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'select-none px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                  )}
                  style={{ color: 'var(--admin-ink-soft)' }}
                >
                  {c.sortable === true ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))
                      }
                      className="inline-flex items-center gap-1 hover:text-[var(--admin-ink)]"
                    >
                      {c.header}
                      {sort?.key === c.key ? (
                        sort.dir === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
              {rowAction !== undefined && <th style={{ background: 'var(--admin-surface-sunken)' }} />}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 && (
              <tr>
                <td colSpan={columns.length + (rowAction !== undefined ? 1 : 0)} className="px-4 py-12 text-center" style={{ color: 'var(--admin-ink-soft)' }}>
                  {empty}
                </td>
              </tr>
            )}
            {paged.map((row) => (
              <tr
                key={row.id}
                className="admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]"
                {...(rowTestId !== undefined ? { 'data-testid': rowTestId(row) } : {})}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn('px-4 py-2.5', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}
                    style={{ color: 'var(--admin-ink)' }}
                  >
                    {c.cell(row)}
                  </td>
                ))}
                {rowAction !== undefined && <td className="px-2 py-2 text-right">{rowAction(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* mobile cards */}
      {!isDesktop && (
      <div>
        {paged.length === 0 && (
          <div className="px-4 py-12 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>
            {empty}
          </div>
        )}
        {paged.map((row) => (
          <div key={row.id} className="admin-hairline-b p-4 last:border-b-0">
            {columns
              .filter((c) => c.hideOnMobile !== true)
              .map((c) => (
                <div key={c.key} className="flex items-start justify-between gap-3 py-1 text-sm">
                  <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--admin-ink-soft)' }}>
                    {c.header}
                  </span>
                  <span className="text-right" style={{ color: 'var(--admin-ink)' }}>
                    {c.cell(row)}
                  </span>
                </div>
              ))}
            {rowAction !== undefined && <div className="mt-2 flex justify-end">{rowAction(row)}</div>}
          </div>
        ))}
      </div>
      )}

      {/* pagination */}
      <div className="admin-hairline-t flex items-center justify-between gap-2 px-4 py-2.5 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
        <div>{t('admin.pageInfo', { n: filtered.length, page: page + 1, pages: pageCount })}</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded border px-2 py-1 disabled:opacity-40"
            style={{ borderColor: 'var(--admin-hairline)', color: 'var(--admin-ink)' }}
          >
            ← {t('admin.prev')}
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            className="rounded border px-2 py-1 disabled:opacity-40"
            style={{ borderColor: 'var(--admin-hairline)', color: 'var(--admin-ink)' }}
          >
            {t('admin.next')} →
          </button>
        </div>
      </div>
    </div>
  )
}
