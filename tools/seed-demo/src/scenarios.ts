import type { TenantPlan } from '@orbetra/shared'

/**
 * The scenario matrix the founder explores the product with: every plan on both tracks, partners
 * with real referrals behind them, and one platform admin.
 *
 * Two decisions worth stating, because they are what make the seed useful rather than merely full:
 *
 * 1. **Direct fleets are seeded NEAR their cap, not at a round number.** `direct_5` gets 4 devices,
 *    `direct_10` gets 8. The cap is the whole difference between Track A and Track B, and a tenant
 *    sitting one device below it demonstrates that in a single click — adding one more works, the
 *    one after that is refused. A fleet seeded at half its cap demonstrates nothing.
 *
 * 2. **Every address is `.test`.** A reserved TLD can never resolve, so no seeded account can send
 *    real mail to a real stranger; the platform refuses those addresses before SES sees them. This
 *    is a rule learned the hard way — a plausible-looking domain in a test once produced a genuine
 *    hard bounce against our sending reputation.
 */
export const SEED_PASSWORD_DEFAULT = 'Orbetra2026!'

/** Audit rows attribute to a fixed seed actor rather than a real person. */
export const SEED_ACTOR = { userId: '00000000-0000-0000-0000-00000000d001' }

export interface PartnerSpec {
  key: string
  name: string
  email: string
  code: string
  commissionPct: number
  commissionMonths: number
  locale: string
}

/**
 * Three partners with deliberately DIFFERENT commercial terms, so the admin screens have something
 * to distinguish. A flat 20%/12mo everywhere would render every partner identical and hide whether
 * the rate is actually read per-partner or assumed.
 */
export const PARTNERS: PartnerSpec[] = [
  { key: 'baltic', name: 'Baltic Telematics', email: 'partner-baltic@orbetra.test', code: 'BALTIC', commissionPct: 25, commissionMonths: 12, locale: 'lt' },
  { key: 'fleetlt', name: 'Fleet Partners LT', email: 'partner-fleetlt@orbetra.test', code: 'FLEETLT', commissionPct: 20, commissionMonths: 24, locale: 'lt' },
  { key: 'nordic', name: 'Nordic GPS Distribution', email: 'partner-nordic@orbetra.test', code: 'NORDIC', commissionPct: 30, commissionMonths: 6, locale: 'en' },
]

export interface UserSpec {
  email: string
  role: 'tsp_admin' | 'account_manager' | 'viewer'
  /** index into the tenant's accounts, or null for a tenant-wide user */
  account: number | null
  locale?: string
}

export interface TenantSpec {
  key: string
  name: string
  plan: TenantPlan
  /** which track this belongs to, for the printed handover table */
  track: 'direct' | 'white-label'
  accounts: { name: string; timezone: string }[]
  users: UserSpec[]
  devices: number
  /** distinct 15-digit IMEI block so two tenants can never collide on a claim */
  imeiBase: bigint
  /** partner key, or null for an organic signup — BOTH shapes must exist to test attribution */
  referredBy: string | null
  branding?: { productName: string; primary: string; accent: string }
  /** white-label custom domain, seeded VERIFIED so the setup screens show a finished state */
  domain?: string
  /** vehicle naming, so a fleet reads like a fleet rather than "Device 7" */
  vehicle: { label: string; plate: string }
}

export const TENANTS: TenantSpec[] = [
  // ── Track A: Direct. No white-label, no API, no webhooks, no sub-accounts, hard device cap. ──
  {
    key: 'direct5',
    name: 'Kurjeris Express',
    plan: 'direct_5',
    track: 'direct',
    accounts: [{ name: 'Kurjeriai', timezone: 'Europe/Vilnius' }],
    users: [{ email: 'direct5@orbetra.test', role: 'tsp_admin', account: null, locale: 'lt' }],
    devices: 4, // cap 5 — one slot left, so the cap is one click away
    imeiBase: 869100000000000n,
    referredBy: 'baltic',
    vehicle: { label: 'Kurjeris', plate: 'KUR' },
  },
  {
    key: 'direct10',
    name: 'Statybų Logistika',
    plan: 'direct_10',
    track: 'direct',
    accounts: [{ name: 'Statybos', timezone: 'Europe/Vilnius' }],
    users: [
      { email: 'direct10@orbetra.test', role: 'tsp_admin', account: null, locale: 'lt' },
      { email: 'direct10-viewer@orbetra.test', role: 'viewer', account: 0, locale: 'lt' },
    ],
    devices: 8, // cap 10
    imeiBase: 869200000000000n,
    referredBy: 'baltic',
    vehicle: { label: 'Savivartis', plate: 'STL' },
  },
  {
    key: 'direct25',
    name: 'Maisto Vežėjai',
    plan: 'direct_25',
    track: 'direct',
    accounts: [{ name: 'Šaldytuvai', timezone: 'Europe/Vilnius' }],
    users: [
      { email: 'direct25@orbetra.test', role: 'tsp_admin', account: null, locale: 'lt' },
      { email: 'direct25-manager@orbetra.test', role: 'account_manager', account: 0, locale: 'lt' },
    ],
    devices: 20, // cap 25
    imeiBase: 869300000000000n,
    referredBy: null, // ORGANIC — no partner, so commission screens must show nothing for it
    vehicle: { label: 'Refrižeratorius', plate: 'MAI' },
  },
  {
    key: 'direct50',
    name: 'Regionų Transportas',
    plan: 'direct_50',
    track: 'direct',
    accounts: [{ name: 'Regionai', timezone: 'Europe/Vilnius' }],
    users: [{ email: 'direct50@orbetra.test', role: 'tsp_admin', account: null, locale: 'lt' }],
    devices: 40, // cap 50
    imeiBase: 869400000000000n,
    referredBy: 'nordic',
    vehicle: { label: 'Vilkikas', plate: 'REG' },
  },
  {
    key: 'direct100',
    name: 'Baltijos Kroviniai',
    plan: 'direct_100',
    track: 'direct',
    accounts: [{ name: 'Kroviniai', timezone: 'Europe/Vilnius' }],
    users: [
      { email: 'direct100@orbetra.test', role: 'tsp_admin', account: null, locale: 'lt' },
      { email: 'direct100-viewer@orbetra.test', role: 'viewer', account: 0, locale: 'en' },
    ],
    devices: 80, // cap 100
    imeiBase: 869500000000000n,
    referredBy: 'fleetlt',
    vehicle: { label: 'Krovininis', plate: 'BAL' },
  },

  // ── Track B: TSP / white-label. Own branding + domain, API + webhooks, sub-accounts, uncapped. ──
  {
    key: 'wlstart',
    name: 'TransBaltic Solutions',
    plan: 'tsp_start',
    track: 'white-label',
    accounts: [
      { name: 'Vilnius', timezone: 'Europe/Vilnius' },
      { name: 'Ryga', timezone: 'Europe/Riga' }, // a SECOND zone on purpose: reports bucket by account zone
    ],
    users: [
      { email: 'wl-start@orbetra.test', role: 'tsp_admin', account: null, locale: 'lt' },
      { email: 'wl-start-manager@orbetra.test', role: 'account_manager', account: 0, locale: 'lt' },
    ],
    devices: 30,
    imeiBase: 869600000000000n,
    referredBy: 'fleetlt',
    branding: { productName: 'TransBaltic Track', primary: '#0f766e', accent: '#14b8a6' },
    domain: 'track.transbaltic.test',
    vehicle: { label: 'TB Truck', plate: 'TBS' },
  },
  {
    key: 'wlgrow',
    name: 'EuroFleet Systems',
    plan: 'tsp_grow',
    track: 'white-label',
    accounts: [
      { name: 'Kaunas', timezone: 'Europe/Vilnius' },
      { name: 'Varšuva', timezone: 'Europe/Warsaw' },
      { name: 'Berlynas', timezone: 'Europe/Berlin' },
    ],
    users: [
      { email: 'wl-grow@orbetra.test', role: 'tsp_admin', account: null, locale: 'en' },
      { email: 'wl-grow-manager@orbetra.test', role: 'account_manager', account: 1, locale: 'pl' },
      { email: 'wl-grow-viewer@orbetra.test', role: 'viewer', account: 2, locale: 'de' },
    ],
    devices: 60,
    imeiBase: 869700000000000n,
    referredBy: 'nordic',
    branding: { productName: 'EuroFleet Live', primary: '#1d4ed8', accent: '#3b82f6' },
    domain: 'gps.eurofleet.test',
    vehicle: { label: 'EF Van', plate: 'EFS' },
  },
  {
    key: 'wlscale',
    name: 'Nordic Telematics Group',
    plan: 'tsp_scale',
    track: 'white-label',
    accounts: [
      { name: 'Oslas', timezone: 'Europe/Oslo' },
      { name: 'Stokholmas', timezone: 'Europe/Stockholm' },
    ],
    users: [
      { email: 'wl-scale@orbetra.test', role: 'tsp_admin', account: null, locale: 'en' },
      { email: 'wl-scale-viewer@orbetra.test', role: 'viewer', account: 0, locale: 'en' },
    ],
    devices: 100,
    imeiBase: 869800000000000n,
    referredBy: null, // ORGANIC — the biggest self-serve tenant has no partner behind it
    branding: { productName: 'Nordic Track', primary: '#7c3aed', accent: '#a78bfa' },
    domain: 'fleet.nordictelematics.test',
    vehicle: { label: 'NT Lastbil', plate: 'NTG' },
  },
  {
    key: 'wlenterprise',
    name: 'Continental Fleet Group',
    plan: 'tsp_enterprise',
    track: 'white-label',
    accounts: [
      { name: 'Vakarų regionas', timezone: 'Europe/Berlin' },
      { name: 'Rytų regionas', timezone: 'Europe/Warsaw' },
      { name: 'Šiaurės regionas', timezone: 'Europe/Vilnius' },
    ],
    users: [
      { email: 'wl-enterprise@orbetra.test', role: 'tsp_admin', account: null, locale: 'en' },
      { email: 'wl-enterprise-manager@orbetra.test', role: 'account_manager', account: 0, locale: 'de' },
    ],
    devices: 150,
    imeiBase: 869900000000000n,
    referredBy: 'baltic',
    branding: { productName: 'Continental Fleet', primary: '#b91c1c', accent: '#ef4444' },
    domain: 'live.continentalfleet.test',
    vehicle: { label: 'CF Truck', plate: 'CFG' },
  },
]

/**
 * The platform tenant the super admin lives in. A `platform_admin` is a ROLE, and the routes it
 * unlocks are cross-tenant — but the user row still belongs somewhere, and putting the founder
 * inside a customer's tenant would make every tenant-scoped screen show that customer's data.
 */
export const PLATFORM_TENANT = { name: 'Orbetra', plan: 'tsp_enterprise' as TenantPlan, account: 'Platforma' }
export const SUPER_ADMIN_EMAIL = 'superadmin@orbetra.test'
