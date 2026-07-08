import { defineConfig } from 'vitest/config'

// Serialize test files: migrate/compressed-insert/audit-coverage each boot a testcontainer;
// running them in parallel (and alongside other packages under the commit gate) contends for
// Docker and times out on container startup. Matches apps/api + apps/worker.
export default defineConfig({ test: { fileParallelism: false } })
