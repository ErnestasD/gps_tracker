import { defineConfig } from 'vitest/config'

// Serialize test files: several specs each boot their own testcontainers (pg/redis);
// running them in parallel contends for Docker and flakes (e.g. tripWriter timeouts).
// Matches apps/api. Same trade as there — a bit slower, but deterministic.
export default defineConfig({ test: { fileParallelism: false } })
