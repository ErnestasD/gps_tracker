/**
 * Bell read-state (ADR-028 round 2): which event ids the user has seen, persisted to
 * localStorage. Device-local like prefs.ts — no server round-trip; events have no per-user
 * read flag server-side. All storage access is try/catch'd: with storage disabled the bell
 * still works for the session (state lives in React), it just forgets on reload.
 */

const KEY = 'orbetra.bell.read'
/** Ids of events that scrolled out of the bell window are useless — cap the stored set. */
const CAP = 300

/** The persisted read-id set ({} when storage is empty/disabled/corrupt). */
export function readIds(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

function persist(ids: Set<string>): void {
  try {
    // keep the newest ids (insertion order — reads are appended)
    localStorage.setItem(KEY, JSON.stringify([...ids].slice(-CAP)))
  } catch {
    // storage disabled/full — read-state stays session-only
  }
}

/** Mark one event read. Returns the next set (new instance — safe as React state). */
export function markRead(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  next.add(id)
  persist(next)
  return next
}

/** Mark every given event read. Returns the next set (new instance). */
export function markAllRead(prev: Set<string>, ids: string[]): Set<string> {
  const next = new Set(prev)
  for (const id of ids) next.add(id)
  persist(next)
  return next
}

/** How many of the given event ids are unread. Pure. */
export function unreadCount(eventIds: string[], read: Set<string>): number {
  let n = 0
  for (const id of eventIds) if (!read.has(id)) n++
  return n
}
