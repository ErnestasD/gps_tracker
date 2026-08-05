import { defineConfig } from 'vitest/config'

// Serialize test files: migrate/compressed-insert/audit-coverage each boot a testcontainer;
// running them in parallel (and alongside other packages under the commit gate) contends for
// Docker and times out on container startup. Matches apps/api + apps/worker.
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
