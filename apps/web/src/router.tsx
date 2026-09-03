import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'

import { type EntitlementKey } from '@orbetra/shared'

import { AppShell } from '@/components/AppShell'
import { getAccessToken, getCurrentUser, refreshSession } from '@/lib/auth'
import { LoginPage } from '@/routes/login'
import { ForgotPasswordPage } from '@/routes/forgotPassword'
import { ResetPasswordPage } from '@/routes/resetPassword'
import { VerifyEmailPage } from '@/routes/verifyEmail'
import { MapPage } from '@/routes/app/map'
import { DashboardPage } from './routes/app/dashboard'
import { AuditPage } from '@/routes/app/audit'
import { BillingPage } from '@/routes/app/billing'
import { BrandingPage } from '@/routes/app/branding'
import { PlaybackPage } from '@/routes/app/playback'
import { TripsPage } from '@/routes/app/trips'
import { GeofencesPage } from '@/routes/app/geofences'
import { RoutePlannerPage } from '@/routes/app/routing'
import { ApiKeysPage } from '@/routes/app/apiKeys'
import { AffiliatesPage } from '@/routes/app/affiliates'
import { PlatformPage } from '@/routes/app/platform'
import { ConsoleShell } from '@/components/ConsoleShell'
import { ConsoleOverviewPage } from '@/routes/platform/overview'
import { ConsoleUsersPage } from '@/routes/platform/users'
import { ConsoleBillingPage } from '@/routes/platform/billing'
import { ConsoleLapsesPage } from '@/routes/platform/lapses'
import { ConsoleErrorsPage } from '@/routes/platform/errors'
import { EventsPage } from '@/routes/app/events'
import { ReportsPage } from '@/routes/app/reports'
import { RulesPage } from '@/routes/app/rules'
import { WebhooksPage } from '@/routes/app/webhooks'
import { DevicesPage } from '@/routes/app/devices/index'
import { DriversPage } from '@/routes/app/drivers'
import { MaintenancePage } from '@/routes/app/maintenance'
import { SettingsPage } from '@/routes/app/settings'
import { SharePage } from '@/routes/share/index'

/** Reload survival: the access token is memory-only, but the httpOnly refresh
 * cookie is not — try a refresh before deciding the user is logged out. */
const hasSession = async (): Promise<boolean> =>
  getAccessToken() !== null || (await refreshSession())

/**
 * Tenant-plan route guard (WP3, defense-in-depth): a deep link / typed URL to a plan-gated page
 * (branding, api-keys, webhooks) must not reach the page for a tenant whose plan lacks the
 * entitlement — the parent /app beforeLoad already established the session, so getCurrentUser() is
 * populated here. Absent entitlement ⇒ bounce to /app (the nav item is hidden for the same reason).
 */
const requireEntitlement = (key: EntitlementKey) => (): void => {
  const user = getCurrentUser()
  if (user === null || user.entitlements[key] !== true) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect idiom
    throw redirect({ to: '/app' })
  }
}

// Code-based route tree (no codegen plugin — nothing generated for typed eslint
// to choke on). /app/* is guarded: no stub token ⇒ bounce to /login (E03-1 swaps
// the guard's token source, tree stays).
const rootRoute = createRootRoute({ component: Outlet })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    // Carry `?lng` through. The site links here with the reader's language, and this redirect used
    // to drop the whole query string — so someone who chose English on orbetra.com arrived at a
    // login page in their browser's language, with the parameter thrown away before anything read
    // it. `search: true` keeps it, and i18next reads it on the next render.
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect idiom
    throw redirect({ to: (await hasSession()) ? '/app' : '/login', search: true })
  },
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const r = search['redirect']
    // internal paths only (review LOW): TanStack navigate can't leave the origin
    // today, but E03-1's real auth must not inherit an unvalidated redirect
    return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? { redirect: r } : {}
  },
  component: LoginPage,
})

// PUBLIC password-reset flow (ADR-031) — no auth, no app shell. Step 1 emails a link; step 2
// redeems the ?token= and sets a new password.
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordPage,
})

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: (search: Record<string, unknown>): { token?: string } => {
    const tk = search['token']
    return typeof tk === 'string' && tk !== '' ? { token: tk } : {}
  },
  component: ResetPasswordPage,
})

// PUBLIC account activation (audit MED #67) — a self-serve signup cannot sign in until the address
// in its `?token=` link is proven. Same shape as reset-password: no auth, no app shell.
const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify-email',
  validateSearch: (search: Record<string, unknown>): { token?: string } => {
    const tk = search['token']
    return typeof tk === 'string' && tk !== '' ? { token: tk } : {}
  },
  component: VerifyEmailPage,
})

// PUBLIC temporary share page (V1-nice) — no auth, no app shell; the token is the capability.
const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/s/$token',
  component: function ShareRoute() {
    const { token } = shareRoute.useParams()
    return <SharePage token={token} />
  },
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  beforeLoad: async ({ location }) => {
    if (!(await hasSession())) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect idiom
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
})

/**
 * The map is the landing page (founder decision 2026-08-18).
 *
 * It is the screen an operator actually works from — the fleet, the live positions, and now the
 * per-device command and settings panels are all on it. The dashboard's aggregate cards are a
 * report you consult, not a place you sit, so it keeps its own route and stays one click away in
 * the nav; landing there put a summary in front of someone who came to look at their vehicles.
 */
const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: MapPage,
})

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/dashboard',
  component: DashboardPage,
})

/**
 * `/app/map` is kept as a redirect, not a second copy of the page.
 *
 * Two canonical URLs for one screen meant no sidebar item highlighted at `/app/map` (active state
 * is an exact pathname match), no breadcrumb, and clicking "Map" from it remounted the page and
 * burned a fresh WS ticket. Old links and bookmarks still work; they just arrive at the real route.
 */
const mapRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/map',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect idiom
    throw redirect({ to: '/app' })
  },
  component: MapPage,
})

const devicesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/devices',
  /**
   * `?can=<deviceId>` opens that device's CAN-parameter panel on arrival.
   *
   * The live map's parameters tab has a gear pointing here, and a deep link is the only way it can
   * work: the devices page opens its per-device panels from local state, so a plain navigation
   * would land the operator on a list with nothing selected — a button that appears to do nothing.
   * Validated rather than free-form, because an unvalidated search param typechecks and then never
   * arrives, which is the same silent failure wearing a different hat.
   */
  validateSearch: (search: Record<string, unknown>): { can?: string } =>
    typeof search.can === 'string' && search.can !== '' ? { can: search.can } : {},
  component: DevicesPage,
})

const driversRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/drivers',
  component: DriversPage,
})

const maintenanceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/maintenance',
  component: MaintenancePage,
})

const brandingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/branding',
  beforeLoad: requireEntitlement('whiteLabel'),
  component: BrandingPage,
})

const billingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/billing',
  component: BillingPage,
})

const playbackRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/playback',
  component: PlaybackPage,
})

const tripsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/trips',
  component: TripsPage,
})

const routingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/routing',
  component: RoutePlannerPage,
})

const geofencesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/geofences',
  component: GeofencesPage,
})

const rulesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/rules',
  component: RulesPage,
})

const eventsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/events',
  component: EventsPage,
  /** `?focus=<id>` — the notification bell hands the page the event it was clicked for, and the
   *  page opens that row's details. Without it the bell could only drop the operator at the top of
   *  a list and leave them to find the alert they just pressed. */
  validateSearch: (search: Record<string, unknown>): { focus?: string } =>
    typeof search['focus'] === 'string' && search['focus'] !== '' ? { focus: search['focus'] } : {},
})

const reportsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/reports',
  component: ReportsPage,
})

const apiKeysRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/api-keys',
  beforeLoad: requireEntitlement('apiAccess'),
  component: ApiKeysPage,
})

const webhooksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/webhooks',
  beforeLoad: requireEntitlement('webhooks'),
  component: WebhooksPage,
})

/**
 * The two pages that moved into the console keep their old URLs as REDIRECTS.
 *
 * Rendering them in both places would be two addresses for one screen — a bookmark, a link in a
 * chat and the sidebar would each land somewhere slightly different, and a fix applied to one would
 * quietly not apply to the other. Redirecting keeps every old link working and leaves exactly one
 * place where each page lives.
 */
const platformRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/platform',
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect idiom
  beforeLoad: () => { throw redirect({ to: '/platform/tenants' }) },
})

const affiliatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/affiliates',
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect idiom
  beforeLoad: () => { throw redirect({ to: '/platform/partners' }) },
})

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/audit',
  component: AuditPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
})

/**
 * The platform console lives at `/platform`, a SIBLING of `/app` rather than a page inside it.
 *
 * A platform admin is not a customer with extra buttons — they run the business the customers are
 * on, and their home should be that business. Signing in used to land them on an ordinary fleet
 * dashboard belonging to whichever tenant their user row happened to live in.
 *
 * The route only checks for a session; the ROLE gate is the server's. Every endpoint behind these
 * pages is `scopeClass: 'platform'` and answers 403 to anyone else, so a non-admin who types the
 * URL gets a console full of refusals rather than data — the boundary is where it can be enforced.
 */
const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform',
  beforeLoad: async ({ location }) => {
    if (!(await hasSession())) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect idiom
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  component: () => (
    <ConsoleShell>
      <Outlet />
    </ConsoleShell>
  ),
})

const consoleIndexRoute = createRoute({ getParentRoute: () => consoleRoute, path: '/', component: ConsoleOverviewPage })
const consoleTenantsRoute = createRoute({ getParentRoute: () => consoleRoute, path: '/tenants', component: PlatformPage })
const consoleUsersRoute = createRoute({ getParentRoute: () => consoleRoute, path: '/users', component: ConsoleUsersPage })
const consoleBillingRoute = createRoute({ getParentRoute: () => consoleRoute, path: '/billing', component: ConsoleBillingPage })
const consoleLapsesRoute = createRoute({ getParentRoute: () => consoleRoute, path: '/lapses', component: ConsoleLapsesPage })
const consolePartnersRoute = createRoute({ getParentRoute: () => consoleRoute, path: '/partners', component: AffiliatesPage })
const consoleErrorsRoute = createRoute({ getParentRoute: () => consoleRoute, path: '/errors', component: ConsoleErrorsPage })

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  verifyEmailRoute,
  shareRoute,
  consoleRoute.addChildren([consoleIndexRoute, consoleTenantsRoute, consoleUsersRoute, consoleBillingRoute, consoleLapsesRoute, consolePartnersRoute, consoleErrorsRoute]),
  appRoute.addChildren([appIndexRoute, dashboardRoute, mapRoute, devicesRoute, driversRoute, maintenanceRoute, tripsRoute, routingRoute, playbackRoute, geofencesRoute, rulesRoute, eventsRoute, reportsRoute, apiKeysRoute, webhooksRoute, platformRoute, affiliatesRoute, brandingRoute, billingRoute, auditRoute, settingsRoute]),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
