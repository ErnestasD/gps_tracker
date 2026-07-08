import type { DeviceProfile, PrismaClient } from '@prisma/client'

/**
 * Device profiles are GLOBAL reference data (not tenant-scoped) — seeded once
 * (packages/db/seed/profiles.ts). Read-only over this repo: list for pickers,
 * `map()` = key→id for CSV import resolution.
 */
export interface ProfileRepo {
  list(): Promise<DeviceProfile[]>
  map(): Promise<Map<string, string>>
}

export function createProfileRepo(prisma: PrismaClient): ProfileRepo {
  return {
    list: () => prisma.deviceProfile.findMany({ orderBy: { key: 'asc' } }),
    map: async () => {
      const rows = await prisma.deviceProfile.findMany({ select: { key: true, id: true } })
      return new Map(rows.map((r) => [r.key, r.id]))
    },
  }
}
