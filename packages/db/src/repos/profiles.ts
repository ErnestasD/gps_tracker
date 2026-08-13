import type { DeviceProfile, PrismaClient } from '@prisma/client'

/**
 * Device profiles are GLOBAL reference data (not tenant-scoped) — seeded once
 * (packages/db/seed/profiles.ts). Read-only over this repo: list for pickers,
 * `map()` = key→id for CSV import resolution.
 */
export interface ProfileRepo {
  /**
   * The models an operator may choose from.
   *
   * Legacy rows are excluded. The four pre-catalogue family profiles (`fmb1xx`, `fmc`,
   * `fmb6xx-stub`, `tat-asset`) still exist because live devices reference them by id — deleting
   * them would orphan a fleet — but offering them alongside 105 real model codes would invite an
   * operator to pick a family when their device has an exact model printed on it, which is the
   * ambiguity this catalogue removes. `get()` still resolves them, so an existing device keeps
   * working and keeps rendering its profile name.
   */
  list(): Promise<DeviceProfile[]>
  /**
   * EVERY profile, legacy included. For resolution, never for a picker: the boot rehydrate builds
   * each device's presence rules from this, and a device sitting on a legacy profile must not come
   * back with no rules because its row was filtered out of a list meant for humans.
   */
  all(): Promise<DeviceProfile[]>
  get(id: string): Promise<DeviceProfile | null>
  map(): Promise<Map<string, string>>
}

export function createProfileRepo(prisma: PrismaClient): ProfileRepo {
  return {
    list: () => prisma.deviceProfile.findMany({ where: { legacy: false }, orderBy: { key: 'asc' } }),
    all: () => prisma.deviceProfile.findMany({ orderBy: { key: 'asc' } }),
    // validated before a device create/claim so a bad (non-existent) profileId is a
    // clean 400, not a Prisma P2003 FK-violation 500 (review MED)
    get: (id) => prisma.deviceProfile.findUnique({ where: { id } }),
    map: async () => {
      const rows = await prisma.deviceProfile.findMany({ select: { key: true, id: true } })
      return new Map(rows.map((r) => [r.key, r.id]))
    },
  }
}
