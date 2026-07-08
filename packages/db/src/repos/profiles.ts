import type { DeviceProfile, PrismaClient } from '@prisma/client'

/**
 * Device profiles are GLOBAL reference data (not tenant-scoped) — seeded once
 * (packages/db/seed/profiles.ts). Read-only over this repo: list for pickers,
 * `map()` = key→id for CSV import resolution.
 */
export interface ProfileRepo {
  list(): Promise<DeviceProfile[]>
  get(id: string): Promise<DeviceProfile | null>
  map(): Promise<Map<string, string>>
}

export function createProfileRepo(prisma: PrismaClient): ProfileRepo {
  return {
    list: () => prisma.deviceProfile.findMany({ orderBy: { key: 'asc' } }),
    // validated before a device create/claim so a bad (non-existent) profileId is a
    // clean 400, not a Prisma P2003 FK-violation 500 (review MED)
    get: (id) => prisma.deviceProfile.findUnique({ where: { id } }),
    map: async () => {
      const rows = await prisma.deviceProfile.findMany({ select: { key: true, id: true } })
      return new Map(rows.map((r) => [r.key, r.id]))
    },
  }
}
