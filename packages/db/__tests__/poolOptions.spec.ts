import { describe, expect, it } from 'vitest'

import { DEFAULT_ACQUIRE_TIMEOUT_MS, DEFAULT_POOL_MAX, DEFAULT_STATEMENT_TIMEOUT_MS, poolOptionsFromEnv } from '../src/pool.js'

/**
 * The pool's env contract (audit MED #30 + its review).
 *
 * The interesting input is the EMPTY STRING, not garbage. `Number('')` is 0 — finite — so a naive
 * guard passes it through to the clamp, where it becomes the FLOOR: pool max 1, acquire timeout
 * 100 ms, statement timeout off. And empty is exactly what this repo's compose produces: every
 * optional variable is written `VAR: ${VAR:-}`, so an operator following the file's own idiom would
 * have dropped the worker to ONE connection shared by 16 shard consumers and a dozen job workers.
 */
describe('poolOptionsFromEnv', () => {
  it('treats an EMPTY variable as absent, not as zero', () => {
    const o = poolOptionsFromEnv({ PG_POOL_MAX: '', PG_ACQUIRE_TIMEOUT_MS: '  ', PG_STATEMENT_TIMEOUT_MS: '' }, { max: 24 })
    expect(o).toEqual({ max: 24, acquireTimeoutMs: DEFAULT_ACQUIRE_TIMEOUT_MS, statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS })
  })

  it('falls back on garbage and on an unset variable', () => {
    expect(poolOptionsFromEnv({})).toEqual({ max: DEFAULT_POOL_MAX, acquireTimeoutMs: DEFAULT_ACQUIRE_TIMEOUT_MS, statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS })
    expect(poolOptionsFromEnv({ PG_POOL_MAX: 'twenty' }).max).toBe(DEFAULT_POOL_MAX)
  })

  it('honours a real value and clamps an absurd one', () => {
    expect(poolOptionsFromEnv({ PG_POOL_MAX: '24' }).max).toBe(24)
    expect(poolOptionsFromEnv({ PG_POOL_MAX: '99999' }).max).toBe(200)
    expect(poolOptionsFromEnv({ PG_POOL_MAX: '-3' }).max).toBe(1)
    expect(poolOptionsFromEnv({ PG_ACQUIRE_TIMEOUT_MS: '1' }).acquireTimeoutMs).toBe(100) // a 1 ms acquire would fail every time
  })

  it('lets an EXPLICIT 0 disable the statement timeout — it is a meaningful Postgres value', () => {
    // …unlike an empty string, which means "unset" and must keep the default
    expect(poolOptionsFromEnv({ PG_STATEMENT_TIMEOUT_MS: '0' }).statementTimeoutMs).toBe(0)
    expect(poolOptionsFromEnv({ PG_STATEMENT_TIMEOUT_MS: '' }).statementTimeoutMs).toBe(DEFAULT_STATEMENT_TIMEOUT_MS)
  })

  it('a caller default (the worker asks for 24) loses to an explicit env value', () => {
    expect(poolOptionsFromEnv({ PG_POOL_MAX: '32' }, { max: 24 }).max).toBe(32)
    expect(poolOptionsFromEnv({}, { max: 24 }).max).toBe(24)
  })
})
