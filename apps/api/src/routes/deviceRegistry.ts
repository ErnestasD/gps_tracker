/**
 * Device registry — MOVED to `@orbetra/registry` (audit MED #22).
 *
 * It lived here while device CRUD was its only writer. Billing suspension has to tear the same keys
 * down from the WORKER, and apps cannot import each other, so the contract now owns a package and
 * this file is a re-export: one owner of the key names and of the delete-if-mine guard, two callers.
 * New code should import from '@orbetra/registry' directly.
 */
export { activateDevice, deactivateDevice, syncDeviceConfig, tenantDevicesKey, suspendTenantDevices, restoreTenantDevices } from '@orbetra/registry'
export type { RegistryDevice, RegistryRef } from '@orbetra/registry'
