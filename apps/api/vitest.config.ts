import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // several specs each spin up a Timescale + Redis testcontainer; running the files
    // in parallel contends for Docker resources (flaky container startup). Serialize
    // the files — still fast enough, reliable locally and in CI.
    fileParallelism: false,
    // Individual `it()`s here talk to real containers (Timescale/Redis) over Docker, so vitest's
    // 5 s DEFAULT is not a meaningful bound — it measures runner load, not correctness. Three
    // separate CI failures were traced to it (liveState pub/sub, gdpr-export, geofence corridor),
    // each time on a green-locally test. Specs that genuinely need a tighter bound set their own.
    testTimeout: 30_000,
  },
})
