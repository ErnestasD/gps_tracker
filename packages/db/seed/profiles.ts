import { PrismaClient } from '@prisma/client'

/**
 * Device-profile seed (E03-3): the four launch profiles (keys align with codec
 * dictionary families). presenceRules feed the trip state machine (§6.4) and the
 * offline sweeper (§6.5); commandPresets are the Codec-12 preset grid (E08-2);
 * readIdleMin is ingest's per-profile read-idle timeout (§6.1). Idempotent upsert
 * by key — safe to re-run. Run: pnpm db:seed:profiles.
 */

interface ProfileSeed {
  key: string
  name: string
  presenceRules: Record<string, unknown>
  commandPresets: unknown[]
  readIdleMin: number
}

export const DEVICE_PROFILES: ProfileSeed[] = [
  {
    key: 'fmb1xx',
    name: 'Teltonika FMB1xx (vehicle)',
    presenceRules: { moveSpeedKmh: 6, movingSustainS: 90, parkedIgnitionOffS: 180, idleSustainS: 120 },
    commandPresets: [
      { name: 'Get info', text: 'getinfo' },
      { name: 'Get GPS', text: 'getgps' },
      { name: 'Get version', text: 'getver' },
    ],
    readIdleMin: 40,
  },
  {
    key: 'fmc',
    name: 'Teltonika FMC (CAN vehicle)',
    presenceRules: { moveSpeedKmh: 6, movingSustainS: 90, parkedIgnitionOffS: 180, idleSustainS: 120 },
    commandPresets: [
      { name: 'Get info', text: 'getinfo' },
      { name: 'Get version', text: 'getver' },
    ],
    readIdleMin: 40,
  },
  {
    key: 'fmb6xx-stub',
    name: 'Teltonika FMB6xx (stub)',
    presenceRules: { moveSpeedKmh: 6, movingSustainS: 90, parkedIgnitionOffS: 180, idleSustainS: 120 },
    commandPresets: [{ name: 'Get version', text: 'getver' }],
    readIdleMin: 40,
  },
  {
    key: 'tat-asset',
    name: 'Teltonika TAT (asset tracker)',
    // asset trackers report infrequently — no-ignition presence + long offline window
    presenceRules: { noIgnition: true, moveSpeedKmh: 3, movingSustainS: 300, parkedDisplaceM: 100, offlineAfterH: 26 },
    commandPresets: [{ name: 'Get GPS', text: 'getgps' }],
    readIdleMin: 1560, // 26 h
  },
]

export async function seedProfiles(databaseUrl: string): Promise<Record<string, string>> {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    const idByKey: Record<string, string> = {}
    for (const p of DEVICE_PROFILES) {
      const presenceRules = p.presenceRules as never
      const commandPresets = p.commandPresets as never
      const row = await prisma.deviceProfile.upsert({
        where: { key: p.key },
        create: { key: p.key, name: p.name, presenceRules, commandPresets, readIdleMin: p.readIdleMin },
        update: { name: p.name, presenceRules, commandPresets, readIdleMin: p.readIdleMin },
      })
      idByKey[p.key] = row.id
    }
    return idByKey
  } finally {
    await prisma.$disconnect()
  }
}

const isEntrypoint = process.argv[1]?.endsWith('seed/profiles.ts') ?? false
if (isEntrypoint) {
  const url = process.env['DATABASE_URL'] ?? 'postgresql://postgres:orbetra_dev@127.0.0.1:5432/orbetra'
  seedProfiles(url)
    .then((ids) => console.log(JSON.stringify(ids)))
    .catch((err: unknown) => {
      console.error(err)
      process.exit(1)
    })
}
