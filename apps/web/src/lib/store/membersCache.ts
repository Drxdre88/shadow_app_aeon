'use client'

import { getAssignablePeople } from '@/lib/actions/virtual-members'

// Per-project cache of the assignable-people list (real members + virtual
// members). The overlay used to fetch this on every open — a full server
// round trip (Neon cold start included) before a single avatar rendered.
// Now the board prefetches once on mount, the overlay opens instantly from
// cache, and a stale entry is refreshed in the background.

export type AssignablePeople = Awaited<ReturnType<typeof getAssignablePeople>>

const TTL_MS = 5 * 60_000

const cache = new Map<string, { at: number; people: AssignablePeople }>()
const inflight = new Map<string, Promise<AssignablePeople>>()

function fetchAndStore(projectId: string): Promise<AssignablePeople> {
  const existing = inflight.get(projectId)
  if (existing) return existing
  const p = getAssignablePeople(projectId)
    .then((people) => {
      cache.set(projectId, { at: Date.now(), people })
      return people
    })
    .finally(() => inflight.delete(projectId))
  inflight.set(projectId, p)
  return p
}

// Synchronous peek — what the overlay renders on first paint.
export function peekAssignablePeople(projectId: string): AssignablePeople | null {
  return cache.get(projectId)?.people ?? null
}

// Stale-while-revalidate: fresh cache resolves immediately; a stale entry is
// returned immediately too while a background refresh replaces it.
export function getAssignablePeopleCached(projectId: string): Promise<AssignablePeople> {
  const entry = cache.get(projectId)
  if (entry) {
    if (Date.now() - entry.at > TTL_MS) void fetchAndStore(projectId).catch(() => {})
    return Promise.resolve(entry.people)
  }
  return fetchAndStore(projectId)
}

// Fire-and-forget warmup (board mount) so the first overlay open is instant.
export function prefetchAssignablePeople(projectId: string): void {
  if (cache.has(projectId) || inflight.has(projectId)) return
  void fetchAndStore(projectId).catch(() => {})
}

// Membership changed (invite accepted, member removed, virtual member CRUD).
export function invalidateAssignablePeople(projectId?: string): void {
  if (projectId) cache.delete(projectId)
  else cache.clear()
}
