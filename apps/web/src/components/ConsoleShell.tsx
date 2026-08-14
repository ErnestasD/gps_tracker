import { Link, useRouterState } from '@tanstack/react-router'
import {
  AlertTriangle,
  Building2,
  CreditCard,
  Handshake,
  LayoutGrid,
  LogOut,
  TimerReset,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { getCurrentUser, logout } from '@/lib/auth'

/**
 * The platform console shell — a SEPARATE panel, not a tab inside the customer dashboard.
 *
 * The distinction was the founder's and it is the right one. `platform_admin` used to be a role
 * that merely added two links to the tenant sidebar, so signing in as the platform owner landed on
 * an ordinary fleet dashboard belonging to whichever tenant that user happened to live in — an
 * empty map, if the answer was "none of them". The job is not "one more customer with extra
 * buttons"; it is running the business the customers are on.
 *
 * So the console has its own route tree (`/platform`), its own navigation, and its own idea of
 * home. The customer-facing app stays exactly as it is and is one click away for anyone who needs
 * to look at it.
 */
interface NavItem {
  key: string
  to: string
  icon: typeof LayoutGrid
  /** the overview sits at the tree root, so prefix matching would light it up on every child page */
  exact?: boolean
}
const NAV: NavItem[] = [
  { key: 'console.nav.overview', to: '/platform', icon: LayoutGrid, exact: true },
  { key: 'console.nav.tenants', to: '/platform/tenants', icon: Building2 },
  { key: 'console.nav.users', to: '/platform/users', icon: Users },
  { key: 'console.nav.billing', to: '/platform/billing', icon: CreditCard },
  { key: 'console.nav.lapses', to: '/platform/lapses', icon: TimerReset },
  { key: 'console.nav.partners', to: '/platform/partners', icon: Handshake },
  { key: 'console.nav.errors', to: '/platform/errors', icon: AlertTriangle },
]

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const user = getCurrentUser()

  return (
    <div className="admin-root flex min-h-screen">
      <aside className="admin-hairline-r hidden w-60 shrink-0 flex-col p-4 md:flex" style={{ background: 'var(--admin-surface)' }}>
        <div className="mb-6 px-2">
          <div className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
            Orbetra
          </div>
          <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--admin-ink-soft)' }}>
            {t('console.title')}
          </div>
        </div>

        <nav className="flex flex-col gap-0.5" aria-label={t('console.title')}>
          {NAV.map((item) => {
            const active = item.exact === true ? pathname === item.to : pathname.startsWith(item.to)
            const Icon = item.icon
            return (
              <Link
                key={item.key}
                to={item.to}
                data-testid={`console-nav-${item.key.split('.').pop()!}`}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm"
                style={{
                  background: active ? 'var(--admin-surface-2)' : 'transparent',
                  color: active ? 'var(--admin-ink)' : 'var(--admin-ink-soft)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                <Icon size={16} aria-hidden />
                {t(item.key)}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-1 pt-4">
          {/* the customer-facing app is one click away — the console replaces the platform admin's
              HOME, not their access to the product they are running */}
          <Link
            to="/app"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm"
            style={{ color: 'var(--admin-ink-soft)' }}
            data-testid="console-nav-app"
          >
            <LayoutGrid size={16} aria-hidden />
            {t('console.nav.backToApp')}
          </Link>
          <div className="admin-hairline-t mt-2 px-2.5 pt-3 text-[11px]" style={{ color: 'var(--admin-ink-soft)' }}>
            {user?.email}
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm"
            style={{ color: 'var(--admin-ink-soft)' }}
            data-testid="console-logout"
          >
            <LogOut size={16} aria-hidden />
            {t('console.nav.logout')}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  )
}
