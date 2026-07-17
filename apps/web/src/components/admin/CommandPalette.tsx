import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { Car, CornerDownLeft, Search } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { listDevices } from '@/lib/devices'
import { filterDevices, filterNav, type PaletteNavEntry } from '@/lib/palette'

/**
 * ⌘K command palette (ADR-028 round 2): quick-nav to every page the role can see, plus
 * device lookup by name/IMEI (fetched lazily — only once the palette opens). Keyboard:
 * arrows move, Enter picks, Esc closes (Radix Dialog). Device picks land on /app/devices.
 */
export function CommandPalette({
  open,
  onOpenChange,
  nav,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** role-filtered nav pages (key = shell.* i18n key) */
  nav: { key: string; to: string }[]
  onNavigate: (to: string) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)

  // devices load lazily, only when the palette is opened (and cache under the shared key)
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices, enabled: open })

  const navEntries: PaletteNavEntry[] = React.useMemo(() => nav.map((i) => ({ ...i, label: t(i.key) })), [nav, t])
  const navMatches = filterNav(navEntries, query)
  const deviceMatches = filterDevices(
    (devices.data ?? []).filter((d) => d.retiredAt === null).map((d) => ({ id: d.id, name: d.name, imei: d.imei })),
    query,
  )

  const go = (to: string) => {
    onOpenChange(false)
    onNavigate(to)
  }

  type Item = { testid: string; label: string; hint?: string; kind: 'nav' | 'device'; pick: () => void }
  const items: Item[] = [
    ...navMatches.map<Item>((n) => ({ testid: `cmdk-item-${n.key}`, label: n.label, kind: 'nav', pick: () => go(n.to) })),
    // device pick lands on the devices page (deep-linking a single device is a follow-up)
    ...deviceMatches.map<Item>((d) => ({ testid: `cmdk-item-device-${d.id}`, label: d.name, hint: d.imei, kind: 'device', pick: () => go('/app/devices') })),
  ]

  // reset selection whenever the result set can change; clear the query on close
  React.useEffect(() => setActive(0), [query, open])
  React.useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[active]?.pick()
    }
  }

  let cursor = -1 // running index across both sections (arrow order = render order)
  const row = (item: Item) => {
    cursor++
    const i = cursor
    return (
      <button
        key={item.testid}
        type="button"
        data-testid={item.testid}
        onClick={item.pick}
        onMouseEnter={() => setActive(i)}
        className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm"
        style={{ color: 'var(--admin-ink)', background: i === active ? 'var(--admin-brand-soft)' : 'transparent' }}
      >
        {item.kind === 'device' && <Car className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.hint !== undefined && <span className="mono text-[11px]" style={{ color: 'var(--admin-ink-soft)' }}>{item.hint}</span>}
        {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />}
      </button>
    )
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 transition-opacity" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[15vh] z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-surface text-text outline-none"
          style={{ boxShadow: 'var(--admin-shadow-md)' }}
          aria-describedby=""
          data-testid="cmdk-palette"
        >
          <DialogPrimitive.Title className="sr-only">{t('shell.search')}</DialogPrimitive.Title>
          <div className="admin-hairline-b flex items-center gap-2.5 px-3.5 py-3">
            <Search className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('shell.searchHint')}
              className="w-full bg-transparent text-sm outline-none placeholder:opacity-60"
              style={{ color: 'var(--admin-ink)' }}
              data-testid="cmdk-input"
            />
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-1.5">
            {items.length === 0 && (
              <div className="px-3 py-10 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>
                {t('shell.paletteEmpty')}
              </div>
            )}
            {navMatches.length > 0 && (
              <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--admin-ink-soft)' }}>
                {t('shell.palettePages')}
              </div>
            )}
            {items.filter((i) => i.kind === 'nav').map(row)}
            {deviceMatches.length > 0 && (
              <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--admin-ink-soft)' }}>
                {t('shell.paletteDevices')}
              </div>
            )}
            {items.filter((i) => i.kind === 'device').map(row)}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
