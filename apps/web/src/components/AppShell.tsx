import { useNavigate, useRouterState } from '@tanstack/react-router'
import {
  BarChart3,
  Bell,
  Building2,
  Car,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  FileText,
  Hexagon,
  IdCard,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  Moon,
  Palette,
  Radio,
  ScrollText,
  Settings,
  Settings2,
  Sun,
  TerminalSquare,
  Webhook,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getCurrentUser, logout as authLogout } from '@/lib/auth'
import { applyBranding, getBranding, type Branding } from '@/lib/branding'
import { liveStore } from '@/lib/liveStore'
import { getTheme, onThemeChange, setTheme, type Theme } from '@/lib/prefs'
import { cn } from '@/lib/utils'

interface NavItem {
  key: string
  icon: typeof MapIcon
  /** Set ⇒ real page (clickable); absent ⇒ disabled placeholder. */
  to?: string
  /** Only render for tenant admins (matches the route's TENANT_ADMINS read gate). */
  adminOnly?: boolean
  /** Only render for platform_admin (matches the route's platform scope gate). */
  platformOnly?: boolean
}
interface NavSection {
  key: string
  items: NavItem[]
}

// Sidebar sections (ADR-028 layout, same gating/keys as before the redesign).
const SECTIONS: NavSection[] = [
  { key: 'shell.live', items: [{ key: 'shell.overview', icon: LayoutDashboard, to: '/app' }, { key: 'shell.map', icon: MapIcon, to: '/app/map' }] },
  {
    key: 'shell.fleet',
    items: [
      { key: 'shell.devices', icon: Car, to: '/app/devices' },
      { key: 'shell.drivers', icon: IdCard, to: '/app/drivers' },
      { key: 'shell.maintenance', icon: Wrench, to: '/app/maintenance' },
      { key: 'shell.trips', icon: Radio, to: '/app/trips' },
      { key: 'shell.history', icon: BarChart3, to: '/app/playback' },
    ],
  },
  { key: 'shell.automation', items: [{ key: 'shell.geofences', icon: Hexagon, to: '/app/geofences' }, { key: 'shell.rules', icon: Settings2, to: '/app/rules' }, { key: 'shell.events', icon: Bell, to: '/app/events' }] },
  { key: 'shell.insights', items: [{ key: 'shell.reports', icon: FileText, to: '/app/reports' }] },
  { key: 'shell.ops', items: [{ key: 'shell.commands', icon: TerminalSquare }] },
  {
    key: 'shell.admin',
    items: [
      { key: 'shell.branding', icon: Palette, to: '/app/branding' },
      { key: 'shell.billing', icon: CreditCard, to: '/app/billing', adminOnly: true },
      { key: 'shell.apiKeys', icon: KeyRound, to: '/app/api-keys', adminOnly: true },
      { key: 'shell.webhooks', icon: Webhook, to: '/app/webhooks', adminOnly: true },
      { key: 'shell.platform', icon: Building2, to: '/app/platform', platformOnly: true },
      { key: 'shell.audit', icon: ScrollText, to: '/app/audit', adminOnly: true },
      { key: 'shell.settings', icon: Settings, to: '/app/settings' },
    ],
  },
]

/** route → nav i18n key, for the topbar breadcrumb */
const CRUMBS = new Map<string, string>(SECTIONS.flatMap((s) => s.items.filter((i) => i.to !== undefined).map((i) => [i.to!, i.key] as const)))

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [theme, setThemeState] = useState<Theme>(getTheme())
  const user = getCurrentUser()
  const role = user?.role
  const isAdmin = role === 'platform_admin' || role === 'tsp_admin'
  // white-label shell (E03-5): the sidebar brand block uses the tenant's productName/logoUrl
  // when present; Orbetra + the local svg are only the fallback
  const [branding, setBranding] = useState<Branding | null>(null)

  // apply the tenant's white-label theme once authenticated (E03-5)
  useEffect(() => {
    getBranding()
      .then((b) => {
        applyBranding(b.branding)
        setBranding(b.branding)
      })
      .catch(() => undefined)
  }, [])

  // close the mobile drawer on navigation
  useEffect(() => setMobileOpen(false), [pathname])

  // the drawer is a modal dialog — Escape must close it (a11y)
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  // stay in sync when the settings page (or anything else) changes the theme
  useEffect(() => onThemeChange(() => setThemeState(getTheme())), [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setThemeState(next)
    setTheme(next)
  }

  const logout = () => {
    void (async () => {
      await authLogout() // revokes the refresh family server-side
      // without this, tenant A's markers survive into tenant B's session
      // (byId never evicts) — a client-side cross-tenant position leak
      liveStore.reset()
      void navigate({ to: '/login' })
    })()
  }

  const crumbKey = CRUMBS.get(pathname)
  const initials = (user?.email ?? '?').slice(0, 2).toUpperCase()

  const sidebar = (withCollapse: boolean) => (
    <>
      <div className={cn('flex h-14 items-center gap-2.5 px-4 admin-hairline-b', collapsed && withCollapse && 'justify-center px-0')}>
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: 'var(--admin-brand-soft)' }}>
          <img src={branding?.logoUrl ?? '/orbetra-logo.svg'} alt="" className="h-5 w-5" />
        </div>
        {!(collapsed && withCollapse) && (
          <div className="min-w-0 leading-tight">
            <div className="display truncate text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{branding?.productName ?? 'Orbetra'}</div>
            <div className="mono text-[9px] uppercase tracking-[0.18em]" style={{ color: 'var(--admin-ink-soft)' }}>{t('shell.admin')}</div>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto py-3">
        {SECTIONS.map((section) => (
          <div key={section.key} className="mb-4">
            {!(collapsed && withCollapse) && (
              <div className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--admin-ink-soft)' }}>
                {t(section.key)}
              </div>
            )}
            {section.items
              .filter((item) => (!item.adminOnly || isAdmin) && (!item.platformOnly || role === 'platform_admin'))
              .map((item) => {
                const Icon = item.icon
                const enabled = item.to !== undefined
                const active = enabled && pathname === item.to
                const rowClass = cn(
                  'mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                  collapsed && withCollapse && 'justify-center',
                  !enabled && 'cursor-not-allowed opacity-50',
                )
                const rowStyle: React.CSSProperties = active
                  ? { background: 'var(--admin-brand-soft)', color: 'var(--admin-brand)', fontWeight: 600 }
                  : { color: enabled ? 'var(--admin-ink)' : 'var(--admin-ink-soft)' }
                if (enabled) {
                  return (
                    <button key={item.key} type="button" aria-current={active ? 'page' : undefined} className={cn(rowClass, !active && 'hover:bg-surface-2')} style={rowStyle} onClick={() => void navigate({ to: item.to! })}>
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {!(collapsed && withCollapse) && <span>{t(item.key)}</span>}
                    </button>
                  )
                }
                const row = (
                  <div key={item.key} aria-disabled className={rowClass} style={rowStyle}>
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {!(collapsed && withCollapse) && <span>{t(item.key)}</span>}
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
      <div className="admin-hairline-t p-2">
        {!(collapsed && withCollapse) && user !== null && (
          <div className="mb-1 flex items-center gap-2.5 rounded-md px-2 py-1.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold" style={{ background: 'var(--admin-brand-soft)', color: 'var(--admin-brand)' }}>
              {initials}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs font-medium" style={{ color: 'var(--admin-ink)' }}>{user.email}</div>
              <div className="truncate text-[10px]" style={{ color: 'var(--admin-ink-soft)' }}>{t(`roles.${user.role}`, user.role)}</div>
            </div>
          </div>
        )}
        {withCollapse && (
          <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => setCollapsed((c) => !c)} aria-label={t(collapsed ? 'shell.expand' : 'shell.collapse')}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </Button>
        )}
      </div>
    </>
  )

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full" style={{ background: 'var(--admin-surface-2)' }}>
        {/* desktop sidebar */}
        <aside className={cn('hidden shrink-0 flex-col bg-surface transition-[width] duration-150 md:flex admin-hairline-r', collapsed ? 'w-16' : 'w-60')}>
          {sidebar(true)}
        </aside>

        {/* mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={t('shell.menu')}>
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface admin-hairline-r">
              <button type="button" className="absolute right-2 top-3.5 p-1" style={{ color: 'var(--admin-ink-soft)' }} onClick={() => setMobileOpen(false)} aria-label={t('shell.close')}>
                <X className="h-4 w-4" />
              </button>
              {sidebar(false)}
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 bg-surface/80 px-4 backdrop-blur admin-hairline-b">
            <button type="button" className="p-1 md:hidden" style={{ color: 'var(--admin-ink)' }} onClick={() => setMobileOpen(true)} aria-label={t('shell.menu')}>
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0 truncate text-sm" style={{ color: 'var(--admin-ink-soft)' }}>
              {t('shell.admin')}
              {crumbKey !== undefined && (
                <>
                  {' '}
                  <span className="opacity-50">›</span>{' '}
                  <span style={{ color: 'var(--admin-ink)' }}>{t(crumbKey)}</span>
                </>
              )}
            </div>
            <div className="flex-1" />
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={t('shell.theme')} data-testid="topbar-theme">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
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
