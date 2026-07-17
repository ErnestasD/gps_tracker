import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { markAllRead, markRead, readIds, unreadCount } from '../src/lib/notifications.js'

/** Minimal in-memory localStorage (vitest runs in node — no DOM). */
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  }
}

function throwingStorage(): Storage {
  const boom = () => {
    throw new Error('storage disabled')
  }
  return { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 }
}

const g = globalThis as { localStorage?: Storage }
let saved: Storage | undefined

beforeEach(() => {
  saved = g.localStorage
  g.localStorage = memoryStorage()
})
afterEach(() => {
  if (saved === undefined) delete g.localStorage
  else g.localStorage = saved
})

describe('bell read-state (lib/notifications)', () => {
  it('starts empty and round-trips markRead through storage', () => {
    expect(readIds().size).toBe(0)
    const next = markRead(readIds(), '42')
    expect(next.has('42')).toBe(true)
    // a fresh read (new session) sees the persisted id
    expect(readIds().has('42')).toBe(true)
  })

  it('markRead returns a NEW set (safe as React state) and keeps prior ids', () => {
    const a = markRead(new Set<string>(), '1')
    const b = markRead(a, '2')
    expect(b).not.toBe(a)
    expect(a.has('2')).toBe(false)
    expect([...b].sort()).toEqual(['1', '2'])
  })

  it('markAllRead marks every given id and persists', () => {
    const next = markAllRead(new Set<string>(['1']), ['2', '3'])
    expect([...next].sort()).toEqual(['1', '2', '3'])
    expect(readIds().size).toBe(3)
  })

  it('unreadCount counts only ids not in the read set', () => {
    const read = new Set(['1', '3'])
    expect(unreadCount(['1', '2', '3', '4'], read)).toBe(2)
    expect(unreadCount([], read)).toBe(0)
    expect(unreadCount(['9'], new Set())).toBe(1)
  })

  it('corrupt storage payloads degrade to an empty set (never throw)', () => {
    localStorage.setItem('orbetra.bell.read', 'not json {')
    expect(readIds().size).toBe(0)
    localStorage.setItem('orbetra.bell.read', '{"a":1}') // not an array
    expect(readIds().size).toBe(0)
    localStorage.setItem('orbetra.bell.read', '["ok", 5, null]') // mixed types filtered
    expect([...readIds()]).toEqual(['ok'])
  })

  it('storage that throws (disabled/quota) never breaks the API', () => {
    g.localStorage = throwingStorage()
    expect(readIds().size).toBe(0)
    const next = markRead(new Set<string>(), '1') // setItem throws — state still advances
    expect(next.has('1')).toBe(true)
    expect(markAllRead(next, ['2']).has('2')).toBe(true)
  })

  it('missing localStorage entirely (SSR-ish) degrades gracefully', () => {
    delete g.localStorage
    expect(readIds().size).toBe(0)
    expect(markRead(new Set<string>(), '1').has('1')).toBe(true)
  })

  it('caps the persisted set so read-state cannot grow unbounded', () => {
    let read = new Set<string>()
    read = markAllRead(
      read,
      Array.from({ length: 350 }, (_, i) => String(i)),
    )
    expect(read.size).toBe(350) // in-memory set keeps everything for the session
    const persisted = readIds()
    expect(persisted.size).toBe(300) // storage keeps the newest CAP ids
    expect(persisted.has('349')).toBe(true)
    expect(persisted.has('0')).toBe(false)
  })
})
