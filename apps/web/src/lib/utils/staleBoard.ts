// Optimistic-concurrency guard for card moves, shared by the server actions and
// the client queue. Pure: no DB, no store, safe to import on either side.

export const STALE_BOARD_PREFIX = 'STALE_BOARD:'

/** Returned (not thrown) by a refused write: production masks thrown action messages. */
export type StaleBoardResult = { staleBoard: true; taskIds: string[] }

export type ExpectedTaskVersion = { id: string; expectedUpdatedAt: string; columnId?: string }
export type CurrentTaskVersion = { id: string; updatedAt: Date | null; columnId: string | null }

/** Millisecond epoch of a client-sent timestamp; rejects anything unparseable. */
export function parseExpectedUpdatedAt(value: unknown): number {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN
  if (Number.isNaN(ms)) throw new Error('Invalid expectedUpdatedAt')
  return ms
}

/**
 * Ids whose stored row is newer than the copy the client moved from. A row
 * already sitting in the requested column is not a conflict: re-applying the
 * move overwrites nothing (this also keeps lost-response replays idempotent).
 */
export function findStaleTaskIds(expected: ExpectedTaskVersion[], current: CurrentTaskVersion[]): string[] {
  const byId = new Map(current.map((row) => [row.id, row]))
  return expected
    .filter((e) => {
      const seenMs = parseExpectedUpdatedAt(e.expectedUpdatedAt)
      const row = byId.get(e.id)
      if (!row?.updatedAt) return false
      if (e.columnId !== undefined && row.columnId === e.columnId) return false
      return row.updatedAt.getTime() > seenMs
    })
    .map((e) => e.id)
}

export function isStaleBoardResult(value: unknown): value is StaleBoardResult {
  return typeof value === 'object' && value !== null && (value as { staleBoard?: unknown }).staleBoard === true
}

// The message must stay free of ids and transport words: the retry classifier
// pattern-matches messages, and a stale refusal must never be retried.
export class StaleBoardError extends Error {
  readonly taskIds: string[]
  constructor(taskIds: string[] = []) {
    super(`${STALE_BOARD_PREFIX} this card changed somewhere else`)
    this.name = 'StaleBoardError'
    this.taskIds = taskIds
  }
}

export function isStaleBoardError(err: unknown): boolean {
  return err instanceof StaleBoardError || (err instanceof Error && err.message.startsWith(STALE_BOARD_PREFIX))
}

/** Throws the client-side error for a refused write; passes any other result through. */
export function throwIfStale<T>(result: T): T {
  if (isStaleBoardResult(result)) throw new StaleBoardError(result.taskIds)
  return result
}
