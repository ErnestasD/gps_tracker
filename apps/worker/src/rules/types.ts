/**
 * Rule engine shared types (E05-4, PROJECT_PLAN §6.5). The engine handles the
 * position/IO-driven kinds only — `geofence` transitions come from the geofence
 * engine (E05-2) and `device_offline` from the sweeper job (E05-4b). Those two are
 * filtered out by the RuleCache so they never reach this engine.
 */
export type EngineRuleKind = 'overspeed' | 'ignition' | 'din_change' | 'power_cut' | 'low_battery' | 'panic'

/** The engine-handled subset of RuleKind, resolved per device by the RuleCache. */
export const ENGINE_RULE_KINDS: readonly EngineRuleKind[] = ['overspeed', 'ignition', 'din_change', 'power_cut', 'low_battery', 'panic']

/** A single enabled rule, flattened for the engine (config is kind-specific, see io.ts/engine.ts). */
export interface RuleDef {
  id: string
  accountId: string
  kind: EngineRuleKind
  name: string
  config: Record<string, unknown>
  cooldownS: number
}

/** An event the engine decided should fire, before cooldown gating / scope resolution. */
export interface RuleEvent {
  deviceId: bigint
  ruleId: string
  kind: EngineRuleKind
  at: Date
  lat: number
  lon: number
  /** per-rule cooldown seconds (persister gates on it) */
  cooldownS: number
  /** panic + power_cut bypass cooldown (§6.5 priority-2) — always persisted */
  bypassCooldown: boolean
  payload: Record<string, unknown>
}
