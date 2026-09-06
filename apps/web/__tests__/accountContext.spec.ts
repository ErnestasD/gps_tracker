import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearAccountContext, getAccountContext, setAccountContext } from '../src/lib/accountContext'
import { getCurrentUser } from '../src/lib/auth'

vi.mock('../src/lib/auth', () => ({ getCurrentUser: vi.fn() }))
const asUser = (id: string | null) =>
  vi.mocked(getCurrentUser).mockReturnValue(id === null ? null : ({ id, accountId: null } as never))

// The suite runs in node (no jsdom in this repo, and one test is not a reason to add a dependency).
// These are the only two browser globals the module touches, and both are small enough to state
// exactly: storage that a real browser would give us, and a target for the change event.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
})
vi.stubGlobal('window', new EventTarget())

/**
 * The account context is the reseller's "acting for" mode, and it lives in localStorage so it
 * survives a refresh. localStorage also outlives a SESSION, which is the whole problem: it used to
 * be a bare accountId, so logging out while acting for one customer and logging in as somebody else
 * opened the new session still filtered to the previous customer — the founder saw the prior
 * account's vehicle on the map for a moment (2026-09-06).
 *
 * Clearing it on the logout button is not enough. A session also ends by expiry, by `clearSession()`
 * on a failed refresh, and in another tab. Binding the stored value to its OWNER closes all of them
 * at the read.
 */
describe('account context is bound to the user who chose it', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetAllMocks()
  })

  it('survives a reload for the person who chose it', () => {
    asUser('user-a')
    setAccountContext('acc-1')
    expect(getAccountContext()).toBe('acc-1')
  })

  it('is INVISIBLE to the next user on the same browser', () => {
    asUser('user-a')
    setAccountContext('acc-1')
    asUser('user-b') // a different person signs in on this tab
    expect(getAccountContext()).toBe('')
  })

  it('is invisible with no session at all — an expired token must not leave a filter behind', () => {
    asUser('user-a')
    setAccountContext('acc-1')
    asUser(null)
    expect(getAccountContext()).toBe('')
  })

  it('a value stored under the old bare-string shape names no owner, so it belongs to nobody', () => {
    localStorage.setItem('orbetra.accountContext', 'acc-legacy')
    asUser('user-a')
    expect(getAccountContext()).toBe('')
  })

  it('logout removes it outright — no foreign accountId sits in a shared browser', () => {
    asUser('user-a')
    setAccountContext('acc-1')
    clearAccountContext()
    expect(localStorage.getItem('orbetra.accountContext')).toBeNull()
    expect(getAccountContext()).toBe('')
  })

  it('selecting "all accounts" clears the stored value rather than storing an empty one', () => {
    asUser('user-a')
    setAccountContext('acc-1')
    setAccountContext('')
    expect(localStorage.getItem('orbetra.accountContext')).toBeNull()
  })
})
