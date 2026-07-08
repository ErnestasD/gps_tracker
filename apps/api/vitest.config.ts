import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // several specs each spin up a Timescale + Redis testcontainer; running the files
    // in parallel contends for Docker resources (flaky container startup). Serialize
    // the files — still fast enough, reliable locally and in CI.
    fileParallelism: false,
  },
})
