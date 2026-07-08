import { useNavigate } from '@tanstack/react-router'
import {
  BarChart3,
  Car,
  ChevronsLeft,
  ChevronsRight,
  Hexagon,
  LogOut,
  Map as MapIcon,
  Palette,
  Radio,
  ScrollText,
  Settings,
  Settings2,
  TerminalSquare,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getCurrentUser, logout as authLogout } from '@/lib/auth'
import { applyBranding, getBranding } from '@/lib/branding'
import { liveStore } from '@/lib/liveStore'
import { cn } from '@/lib/utils'

interface NavItem {
  key: string
  icon: typeof MapIcon
  /** Set ⇒ real page (clickable); absent ⇒ disabled placeholder. */
  to?: string
  /** Only render for tenant admins (matches the route's TENANT_ADMINS read gate). */
  adminOnly?: boolean
}
interface NavSection {
  key: string
  items: NavItem[]
}

// Spec §2 sidebar sections. Live→Map and Admin→Settings are real pages; the rest
// are disabled placeholders their stories light up (E03-3, E04-x, E05-x, E06-1, E08-2).
const SECTIONS: NavSection[] = [
  { key: 'shell.live', items: [{ key: 'shell.map', icon: MapIcon, to: '/app/map' }] },
  {
    key: 'shell.fleet',
    items: [
      { key: 'shell.devices', icon: Car, to: '/app/devices' },
      { key: 'shell.trips', icon: Radio },
      { key: 'shell.history', icon: BarChart3, to: '/app/playback' },
    ],
  },
  { key: 'shell.automation', items: [{ key: 'shell.geofences', icon: Hexagon }, { key: 'shell.rules', icon: Settings2 }] },
  { key: 'shell.ops', items: [{ key: 'shell.commands', icon: TerminalSquare }] },
  {
    key: 'shell.admin',
    items: [
      { key: 'shell.branding', icon: Palette, to: '/app/branding' },
      { key: 'shell.audit', icon: ScrollText, to: '/app/audit', adminOnly: true },
      { key: 'shell.settings', icon: Settings, to: '/app/settings' },
    ],
  },
]

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const role = getCurrentUser()?.role
  const isAdmin = role === 'platform_admin' || role === 'tsp_admin'

  // apply the tenant's white-label theme once authenticated (E03-5)
  useEffect(() => {
    getBranding()
      .then((b) => applyBranding(b.branding))
      .catch(() => undefined)
  }, [])

  const logout = () => {
    void (async () => {
      await authLogout() // revokes the refresh family server-side
      // without this, tenant A's markers survive into tenant B's session
      // (byId never evicts) — a client-side cross-tenant position leak
      liveStore.reset()
      void navigate({ to: '/login' })
    })()
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full">
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-150',
            collapsed ? 'w-16' : 'w-60',
          )}
        >
          <div className={cn('flex h-14 items-center gap-2 border-b border-line px-4', collapsed && 'justify-center px-0')}>
            <img src="/icons/pwa-192.png" alt="" className="h-6 w-6 rounded" />
            {!collapsed && <span className="text-sm font-semibold tracking-wide">Orbetra</span>}
          </div>
          <nav className="flex-1 overflow-y-auto py-3">
            {SECTIONS.map((section) => (
              <div key={section.key} className="mb-4">
                {!collapsed && (
                  <div className="px-4 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted">
                    {t(section.key)}
                  </div>
                )}
                {section.items.filter((item) => !item.adminOnly || isAdmin).map((item) => {
                  const Icon = item.icon
                  const enabled = item.to !== undefined
                  const rowClass = cn(
                    'relative mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-card px-2 py-2 text-left text-sm',
                    collapsed && 'justify-center',
                    enabled
                      ? 'text-text hover:bg-surface-2 before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded before:bg-accent'
                      : 'cursor-not-allowed text-muted/60',
                  )
                  if (enabled) {
                    return (
                      <button key={item.key} type="button" className={rowClass} onClick={() => void navigate({ to: item.to! })}>
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        {!collapsed && <span>{t(item.key)}</span>}
                      </button>
                    )
                  }
                  const row = (
                    <div key={item.key} aria-disabled className={rowClass}>
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {!collapsed && <span>{t(item.key)}</span>}
                    </div>
                  )
                  return (
                    <Tooltip key={item.key}>
                      <TooltipTrigger asChild>{row}</TooltipTrigger>
                      <TooltipContent side="right">{t('shell.soon')}</TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            ))}
          </nav>
          <div className="border-t border-line p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={t(collapsed ? 'shell.expand' : 'shell.collapse')}
            >
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-4">
            <div className="text-sm text-muted">{t('shell.live')} · {t('shell.map')}</div>
            <Button variant="ghost" size="sm" onClick={logout} data-testid="logout">
              <LogOut className="h-4 w-4" aria-hidden />
              {t('shell.logout')}
            </Button>
          </header>
          <main className="relative min-h-0 flex-1">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  )
}
