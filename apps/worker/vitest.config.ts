import { defineConfig } from 'vitest/config'

// Serialize test files: several specs each boot their own testcontainers (pg/redis);
// running them in parallel contends for Docker and flakes (e.g. tripWriter timeouts).
// Matches apps/api. Same trade as there — a bit slower, but deterministic.
export default defineConfig({
  test: {
    fileParallelism: false,
    // Individual `it()`s here talk to real containers (Timescale/Redis) over Docker, so vitest's
    // 5 s DEFAULT is not a meaningful bound — it measures runner load, not correctness. Three
    // separate CI failures were traced to it (liveState pub/sub, gdpr-export, geofence corridor),
    // each time on a green-locally test. Specs that genuinely need a tighter bound set their own.
    testTimeout: 30_000,
  },
})
