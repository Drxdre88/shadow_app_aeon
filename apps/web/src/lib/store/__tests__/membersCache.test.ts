import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AssignablePeople } from '../membersCache'

// The assignee overlay opens from this cache instead of a server round trip.
// Everything that makes it feel instant is invisible until it breaks:
//   - single-flight, so a board mount + an overlay open are ONE fetch
//   - stale-while-revalidate, so an expired entry still paints immediately
//   - a failed fetch leaves no poisoned entry behind
// None of it had a test; a regression here shows up as a spinner or, worse,
// a stale member list that silently outlives an invite.

const { getAssignablePeople } = vi.hoisted(() => ({ getAssignablePeople: vi.fn() }))
vi.mock('@/lib/actions/virtual-members', () => ({ getAssignablePeople }))

type CacheModule = typeof import('../membersCache')

const TTL_MS = 5 * 60_000
const P = 'project-1'
const P2 = 'project-2'

const peopleA = { members: [{ userId: 'u1' }], virtualMembers: [] } as unknown as AssignablePeople
const peopleB = { members: [{ userId: 'u1' }, { userId: 'u2' }], virtualMembers: [] } as unknown as AssignablePeople

// Module-level Maps hold the cache, so every test gets a fresh module.
async function freshCache(): Promise<CacheModule> {
  vi.resetModules()
  return import('../membersCache')
}

// Let the fetch chain (.then -> cache.set, .finally -> inflight.delete) run.
// Microtasks are NOT faked, so a few flushes settle everything deterministically.
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-26T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('single-flight', () => {
  it('collapses two concurrent cold reads into one server call', async () => {
    const cache = await freshCache()
    let resolveFetch: (v: AssignablePeople) => void = () => {}
    getAssignablePeople.mockReturnValueOnce(new Promise((r) => { resolveFetch = r }))

    const first = cache.getAssignablePeopleCached(P)
    const second = cache.getAssignablePeopleCached(P)

    expect(getAssignablePeople).toHaveBeenCalledTimes(1)

    resolveFetch(peopleA)
    expect(await first).toBe(peopleA)
    expect(await second).toBe(peopleA)
  })

  it('collapses a prefetch and an overlay open racing on board mount', async () => {
    const cache = await freshCache()
    let resolveFetch: (v: AssignablePeople) => void = () => {}
    getAssignablePeople.mockReturnValueOnce(new Promise((r) => { resolveFetch = r }))

    cache.prefetchAssignablePeople(P)      // board mounts
    const open = cache.getAssignablePeopleCached(P) // user hits M immediately

    expect(getAssignablePeople).toHaveBeenCalledTimes(1)

    resolveFetch(peopleA)
    expect(await open).toBe(peopleA)
  })

  it('keeps separate projects on separate lanes', async () => {
    const cache = await freshCache()
    getAssignablePeople.mockResolvedValue(peopleA)

    await Promise.all([cache.getAssignablePeopleCached(P), cache.getAssignablePeopleCached(P2)])

    expect(getAssignablePeople).toHaveBeenCalledTimes(2)
    expect(getAssignablePeople).toHaveBeenCalledWith(P)
    expect(getAssignablePeople).toHaveBeenCalledWith(P2)
  })
})

describe('stale-while-revalidate', () => {
  it('serves a fresh entry without touching the server', async () => {
    const cache = await freshCache()
    getAssignablePeople.mockResolvedValueOnce(peopleA)
    await cache.getAssignablePeopleCached(P)

    vi.advanceTimersByTime(TTL_MS - 1)
    expect(await cache.getAssignablePeopleCached(P)).toBe(peopleA)
    expect(getAssignablePeople).toHaveBeenCalledTimes(1)
  })

  it('past the TTL: resolves the cached list immediately AND refetches exactly once', async () => {
    const cache = await freshCache()
    getAssignablePeople.mockResolvedValueOnce(peopleA)
    await cache.getAssignablePeopleCached(P)

    vi.advanceTimersByTime(TTL_MS + 1)

    let resolveRefresh: (v: AssignablePeople) => void = () => {}
    getAssignablePeople.mockReturnValueOnce(new Promise((r) => { resolveRefresh = r }))

    // Two stale reads back to back — the second must ride the first's refresh.
    const a = cache.getAssignablePeopleCached(P)
    const b = cache.getAssignablePeopleCached(P)

    expect(getAssignablePeople).toHaveBeenCalledTimes(2)
    // The user sees the old list NOW; the refresh is still in flight.
    expect(await a).toBe(peopleA)
    expect(await b).toBe(peopleA)
    expect(cache.peekAssignablePeople(P)).toBe(peopleA)

    resolveRefresh(peopleB)
    await flush()

    expect(cache.peekAssignablePeople(P)).toBe(peopleB)
    expect(getAssignablePeople).toHaveBeenCalledTimes(2)
  })

  it('a background refresh that fails leaves the stale entry usable', async () => {
    const cache = await freshCache()
    getAssignablePeople.mockResolvedValueOnce(peopleA)
    await cache.getAssignablePeopleCached(P)

    vi.advanceTimersByTime(TTL_MS + 1)
    getAssignablePeople.mockRejectedValueOnce(new Error('offline'))

    // Must NOT reject: the caller asked for a list, and we have one.
    expect(await cache.getAssignablePeopleCached(P)).toBe(peopleA)
    await flush()
    expect(cache.peekAssignablePeople(P)).toBe(peopleA)
  })
})

describe('prefetch', () => {
  it('is a no-op when the entry is already warm', async () => {
    const cache = await freshCache()
    getAssignablePeople.mockResolvedValueOnce(peopleA)
    await cache.getAssignablePeopleCached(P)

    cache.prefetchAssignablePeople(P)
    cache.prefetchAssignablePeople(P)
    await flush()

    expect(getAssignablePeople).toHaveBeenCalledTimes(1)
  })

  it('is a no-op while a fetch is already in flight', async () => {
    const cache = await freshCache()
    getAssignablePeople.mockReturnValueOnce(new Promise(() => {}))

    cache.prefetchAssignablePeople(P)
    cache.prefetchAssignablePeople(P)

    expect(getAssignablePeople).toHaveBeenCalledTimes(1)
  })

  it('warms the synchronous peek the overlay paints from', async () => {
    const cache = await freshCache()
    expect(cache.peekAssignablePeople(P)).toBeNull()

    getAssignablePeople.mockResolvedValueOnce(peopleA)
    cache.prefetchAssignablePeople(P)
    await flush()

    expect(cache.peekAssignablePeople(P)).toBe(peopleA)
  })
})

describe('invalidation', () => {
  it('forces the next read to refetch', async () => {
    const cache = await freshCache()
    getAssignablePeople.mockResolvedValueOnce(peopleA)
    await cache.getAssignablePeopleCached(P)

    cache.invalidateAssignablePeople(P)
    expect(cache.peekAssignablePeople(P)).toBeNull()

    getAssignablePeople.mockResolvedValueOnce(peopleB)
    expect(await cache.getAssignablePeopleCached(P)).toBe(peopleB)
    expect(getAssignablePeople).toHaveBeenCalledTimes(2)
    expect(cache.peekAssignablePeople(P)).toBe(peopleB)
  })

  it('only drops the project it was given', async () => {
    const cache = await freshCache()
    getAssignablePeople.mockResolvedValue(peopleA)
    await cache.getAssignablePeopleCached(P)
    await cache.getAssignablePeopleCached(P2)

    cache.invalidateAssignablePeople(P)

    expect(cache.peekAssignablePeople(P)).toBeNull()
    expect(cache.peekAssignablePeople(P2)).toBe(peopleA)
  })

  it('clears every project when called with no argument', async () => {
    const cache = await freshCache()
    getAssignablePeople.mockResolvedValue(peopleA)
    await cache.getAssignablePeopleCached(P)
    await cache.getAssignablePeopleCached(P2)

    cache.invalidateAssignablePeople()

    expect(cache.peekAssignablePeople(P)).toBeNull()
    expect(cache.peekAssignablePeople(P2)).toBeNull()
  })
})

describe('failure handling', () => {
  it('does not poison the cache — the next read retries and succeeds', async () => {
    const cache = await freshCache()
    getAssignablePeople.mockRejectedValueOnce(new Error('boom'))

    await expect(cache.getAssignablePeopleCached(P)).rejects.toThrow('boom')
    expect(cache.peekAssignablePeople(P)).toBeNull()

    getAssignablePeople.mockResolvedValueOnce(peopleA)
    expect(await cache.getAssignablePeopleCached(P)).toBe(peopleA)
    expect(cache.peekAssignablePeople(P)).toBe(peopleA)
  })

  it('releases the in-flight lane so a failure cannot wedge the project forever', async () => {
    const cache = await freshCache()
    getAssignablePeople.mockRejectedValueOnce(new Error('boom'))

    cache.prefetchAssignablePeople(P) // swallows its own rejection
    await flush()

    getAssignablePeople.mockResolvedValueOnce(peopleA)
    expect(await cache.getAssignablePeopleCached(P)).toBe(peopleA)
    expect(getAssignablePeople).toHaveBeenCalledTimes(2)
  })
})
