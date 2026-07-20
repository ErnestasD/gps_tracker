import { hash } from '@node-rs/argon2'
import { PrismaClient } from '@prisma/client'

import { ARGON2ID_PARAMS, ROLES, TENANT_PLANS, type Role, type TenantPlan } from '@orbetra/shared'

/**
 * Dev/e2e user seed (E03-1): converges a tenant (+optional account) and upserts a
 * user with an argon2id-hashed password. Idempotent — safe to re-run; the password
 * is re-hashed each time. Params come from the SINGLE SOURCE in @orbetra/shared so
 * the AC[3] anti-weakening test guards this path too.
 *
 * Usage:
 *   pnpm db:seed:user -- --email a@b.c --password '…' --role tsp_admin \
 *     --tenant-name "Demo TSP" [--account-name "Fleet A"] [--database-url …]
 *
 * Prints {tenantId, accountId?, userId} JSON on stdout (consumed by Playwright
 * global-setup). NOT a production tool — real user CRUD arrives with E03-2.
 */

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1]!
  if (fallback !== undefined) return fallback
  console.error(`missing required --${name}`)
  process.exit(2)
}

export interface SeedUserOpts {
  databaseUrl: string
  email: string
  password: string
  role: Role
  tenantName: string
  accountName?: string
  locale?: string
  /** entitlement tier for a NEWLY created tenant (default tsp_grow, preserving current behavior); lets the
   *  seeder stand up Direct demo tenants. An EXISTING tenant of the same name keeps its stored plan. */
  plan?: TenantPlan
}

export async function seedUser(opts: SeedUserOpts): Promise<{ tenantId: string; accountId: string | null; userId: string }> {
  if ((opts.role === 'account_manager' || opts.role === 'viewer') && !opts.accountName) {
    throw new Error(`role ${opts.role} is account-scoped — pass --account-name`)
  }
  const prisma = new PrismaClient({ datasourceUrl: opts.databaseUrl })
  try {
    const tenant =
      (await prisma.tenant.findFirst({ where: { name: opts.tenantName } })) ??
      (await prisma.tenant.create({
        // plan applies to NEW tenants only; the DB default (tsp_grow) covers the common case
        data: { name: opts.tenantName, branding: {}, ...(opts.plan !== undefined ? { plan: opts.plan } : {}) },
      }))

    // The named account is created if given (device create form / fixtures need one),
    // but a TENANT-WIDE role (platform_admin/tsp_admin) keeps accountId null — only
    // account-scoped roles are pinned to it. (Otherwise a tenant admin's JWT carries
    // an acc claim and the WS/scope treats them as account-scoped.)
    let createdAccountId: string | null = null
    if (opts.accountName) {
      const account =
        (await prisma.account.findFirst({ where: { tenantId: tenant.id, name: opts.accountName } })) ??
        (await prisma.account.create({ data: { tenantId: tenant.id, name: opts.accountName, timezone: 'UTC' } }))
      createdAccountId = account.id
    }
    const accountScoped = opts.role === 'account_manager' || opts.role === 'viewer'
    const userAccountId = accountScoped ? createdAccountId : null

    // normalize at write time so login's equality lookup is consistent (login lowercases too)
    const email = opts.email.trim().toLowerCase()
    // algorithm: 2 = Algorithm.Argon2id (@node-rs/argon2 const enum — unusable
    // directly under isolatedModules); PHC output asserted argon2id by AC[3] test
    const passwordHash = await hash(opts.password, { algorithm: 2, ...ARGON2ID_PARAMS })
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      create: { tenantId: tenant.id, accountId: userAccountId, email, passwordHash, role: opts.role, locale: opts.locale ?? 'en' },
      update: { passwordHash, role: opts.role, accountId: userAccountId },
    })
    return { tenantId: tenant.id, accountId: createdAccountId, userId: user.id }
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<void> {
  const roleArg = arg('role', 'tsp_admin')
  if (!(ROLES as readonly string[]).includes(roleArg)) {
    console.error(`--role must be one of: ${ROLES.join(', ')}`)
    process.exit(2)
  }
  const planArg = arg('plan', 'tsp_grow')
  if (!(TENANT_PLANS as readonly string[]).includes(planArg)) {
    console.error(`--plan must be one of: ${TENANT_PLANS.join(', ')}`)
    process.exit(2)
  }
  const accountName = arg('account-name', '')
  const result = await seedUser({
    databaseUrl: arg('database-url', process.env['DATABASE_URL'] ?? 'postgresql://postgres:orbetra_dev@127.0.0.1:5432/orbetra'),
    email: arg('email'),
    password: arg('password'),
    role: roleArg as Role,
    tenantName: arg('tenant-name', 'Dev Tenant'),
    plan: planArg as TenantPlan,
    ...(accountName !== '' ? { accountName } : {}),
  })
  console.log(JSON.stringify(result))
}

const isEntrypoint = process.argv[1]?.endsWith('seed/users.ts') ?? false
if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
