'use client'

import { useBoardStore, type BoardTask } from './boardStore'
import type { MoveUpdate, QueuedMutation } from './mutationDispatch'

export const STALE_MOVE_TOAST = 'This card changed somewhere else — the board has been refreshed'

type MoveSnapshot = { id: string; columnId?: string }[]

/**
 * Stamps each column-changing entry with the updatedAt its card was moved
 * from, so the server can refuse a move made on an out-of-date board. Entries
 * that stay in their column (pure reorders) are left unguarded.
 */
export function withExpectedOnMoves(updates: MoveUpdate[], tasks: BoardTask[], snapshot?: MoveSnapshot): MoveUpdate[] {
  const seen = new Map(tasks.map((t) => [t.id, t.updatedAt]))
  const before = new Map((snapshot ?? []).map((s) => [s.id, s.columnId]))
  return updates.map((u) => {
    if (!u.columnId) return u
    if (before.has(u.id) && before.get(u.id) === u.columnId) return u
    const expectedUpdatedAt = seen.get(u.id)
    return expectedUpdatedAt ? { ...u, expectedUpdatedAt } : u
  })
}

/** Same guard for a single-card update that changes its column. */
export function withExpectedOnUpdate(updates: Record<string, unknown>, task?: BoardTask): Record<string, unknown> {
  if (updates.columnId === undefined || !task?.updatedAt) return updates
  return { ...updates, expectedUpdatedAt: task.updatedAt }
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value
  return null
}

/** The server's new updatedAt for every card a successful write touched. */
export function freshnessFromResult(ids: string[], result: unknown): Record<string, string> {
  const iso = toIso((result as { updatedAt?: unknown } | null | undefined)?.updatedAt)
  if (!iso) return {}
  return Object.fromEntries(ids.map((id) => [id, iso]))
}

export function taskIdsOf(m: QueuedMutation): string[] {
  switch (m.type) {
    case 'task.create': return [m.args.id]
    case 'task.update': return [m.args.taskId]
    case 'task.move': return m.args.updates.map((u) => u.id)
    default: return []
  }
}

/**
 * Writes still queued behind a successful one were made on top of it, so they
 * inherit its version — the user's own consecutive moves never read as stale.
 */
export function rebasePending(pending: QueuedMutation[], fresh: Record<string, string>): QueuedMutation[] {
  return pending.map((m) => {
    if (m.type === 'task.update') {
      const next = fresh[m.args.taskId]
      if (!next || typeof m.args.updates.expectedUpdatedAt !== 'string') return m
      return { ...m, args: { ...m.args, updates: { ...m.args.updates, expectedUpdatedAt: next } } }
    }
    if (m.type === 'task.move' && m.args.updates.some((u) => u.expectedUpdatedAt && fresh[u.id])) {
      const updates = m.args.updates.map((u) => (u.expectedUpdatedAt && fresh[u.id] ? { ...u, expectedUpdatedAt: fresh[u.id] } : u))
      return { ...m, args: { ...m.args, updates } }
    }
    return m
  })
}

/** Records the server's version on the cards without marking the board dirty. */
export function applyFreshness(fresh: Record<string, string>): void {
  if (Object.keys(fresh).length === 0) return
  useBoardStore.setState((s) => ({
    tasks: s.tasks.map((t) => {
      const next = fresh[t.id]
      if (!next || (t.updatedAt && Date.parse(t.updatedAt) >= Date.parse(next))) return t
      return { ...t, updatedAt: next }
    }),
  }))
}
