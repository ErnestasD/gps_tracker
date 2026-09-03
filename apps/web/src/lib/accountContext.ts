import { getCurrentUser } from './auth'

/**
 * The reseller's ACCOUNT CONTEXT — the spine of the TSP-admin experience (founder decision
 * 2026-09-03, TSP UX audit).
 *
 * A tenant-wide TSP admin sees every customer account's data merged, and that merged view is the
 * wrong place to act: a geofence created there lands tenant-shared (visible to EVERY customer), a
 * rule edited there is some customer's rule edited from a view where nothing says whose. The model:
 *
 *   - context '' ("all accounts") — the OVERSEER view: every page filters to nothing, i.e. shows
 *     everything, and OPERATIONAL writes are withheld. Look, compare, drill in.
 *   - context '<accountId>' — ACTING FOR that customer: pages filter to the account, creates carry
 *     its accountId, and editing is offered exactly as it is to the customer themselves.
 *
 * Deliberately CLIENT-side, like theme and display prefs (prefs.ts pattern): the server already
 * authorises a tenant-wide admin for all of it, so this is not a security boundary — it is the
 * difference between acting deliberately and acting by accident. Server-side enforcement per
 * account stays exactly where it was: on the customer's own tokens.
 *
 * Not in the URL, in localStorage: the context is a mode you put yourself in, not a property of one
 * page — following a link must not silently switch whose data you are editing.
 */
const KEY = 'orbetra.accountContext'
const EVENT = 'orbetra:account-context'

/** '' = all accounts (overview). Otherwise the accountId being acted for. */
export function getAccountContext(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAccountContext(accountId: string): void {
  try {
    if (accountId === '') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, accountId)
  } catch {
    /* storage disabled — context still applies for this render via the event */
  }
  window.dispatchEvent(new Event(EVENT))
}

/** Subscribe to context changes made anywhere in the app. Returns the unsubscribe. */
export function onAccountContextChange(cb: () => void): () => void {
  window.addEventListener(EVENT, cb)
  return () => window.removeEventListener(EVENT, cb)
}

/** Is the current user a tenant-wide overseer (the only role the switcher exists for)?
 *  Account-scoped users have a fixed context — their own account — and never see the switcher. */
export function isOverseer(): boolean {
  const u = getCurrentUser()
  return (u?.role === 'tsp_admin' || u?.role === 'platform_admin') && u.accountId === null
}

/**
 * The context every DATA decision should use:
 *   - account-scoped user → their own account, always (the switcher cannot override a token)
 *   - overseer → the chosen context ('' = all)
 */
export function effectiveAccountContext(): string {
  const u = getCurrentUser()
  if (u === null) return ''
  if (u.accountId !== null) return u.accountId
  return getAccountContext()
}

/** May the current user OPERATE (create/edit operational objects) right now?
 *  Overseer in "all accounts" = no — that is the founder's read-only overview rule.
 *  Overseer acting for an account, or any account-scoped writer = role decides, as before. */
export function canOperateInContext(): boolean {
  if (!isOverseer()) return true
  return getAccountContext() !== ''
}

// ── React binding ────────────────────────────────────────────────────────────
import { useSyncExternalStore } from 'react'

const subscribe = (cb: () => void): (() => void) => onAccountContextChange(cb)

/** The reactive context for pages: re-renders on switch, resolves the pin for account users. */
export function useAccountContext(): { ctx: string; overseer: boolean; canOperate: boolean } {
  const ctx = useSyncExternalStore(subscribe, effectiveAccountContext, effectiveAccountContext)
  const overseer = isOverseer()
  return { ctx, overseer, canOperate: !overseer || ctx !== '' }
}
