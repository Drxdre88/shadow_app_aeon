import { db } from '@/lib/db'
import { activityEvents, boardColumns, boardTasks, userPreferences } from '@/lib/db/schema'
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm'
import {
  kairosPromisesStateSchema,
  type KairosPromise,
  type KairosPromisesState,
  type ListKairosPromisesInput,
} from './validators/kairos-promises'

// Kairos promises live as the server-owned `kairosPromises` key inside
// user_preferences.preferences (no schema change). This module is the ONLY
// writer: every write runs mutateKairosPromises — SELECT … FOR UPDATE on the
// user's preferences row inside db.transaction, a pure mutation, then a jsonb
// merge of just this key. upsertPreferences (theme sync) strips and carries
// the key over, so a theme save can neither set nor wipe it.
export const KAIROS_PROMISES_PREF_KEY = 'kairosPromises'

export class KairosPromisesCorruptError extends Error {
  constructor(detail: string) {
    super(`kairosPromises preference is malformed: ${detail}`)
    this.name = 'KairosPromisesCorruptError'
  }
}

export function emptyPromisesState(): KairosPromisesState {
  return { v: 1, nextSeq: 1, open: [], closed: [] }
}

// Missing key = no promises yet. A present but malformed blob throws so no
// write path can silently clobber it.
export function parsePromisesState(raw: unknown): KairosPromisesState {
  if (raw === undefined || raw === null) return emptyPromisesState()
  const parsed = kairosPromisesStateSchema.safeParse(raw)
  if (!parsed.success) throw new KairosPromisesCorruptError(parsed.error.issues[0]?.message ?? 'invalid')
  return parsed.data
}

const promisesValue = sql<unknown>`${userPreferences.preferences} -> ${KAIROS_PROMISES_PREF_KEY}::text`

export async function readKairosPromises(userId: string): Promise<KairosPromisesState> {
  const row = await db
    .select({ value: promisesValue })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  return parsePromisesState(row?.value)
}

// `state: null` = nothing to write. The mutation must be pure: it can run a
// second time if a concurrent first insert of the preferences row wins.
export type PromisesMutation<R> = (state: KairosPromisesState) => { state: KairosPromisesState | null; result: R }

export async function mutateKairosPromises<R>(userId: string, mutate: PromisesMutation<R>): Promise<R> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = await tx
        .select({ value: promisesValue })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .for('update')
      const { state, result } = mutate(parsePromisesState(rows[0]?.value))
      if (!state) return result
      const next = kairosPromisesStateSchema.parse(state)
      if (rows.length > 0) {
        await tx
          .update(userPreferences)
          .set({
            preferences: sql`${userPreferences.preferences} || jsonb_build_object(${KAIROS_PROMISES_PREF_KEY}::text, ${JSON.stringify(next)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.userId, userId))
        return result
      }
      const inserted = await tx
        .insert(userPreferences)
        .values({ userId, preferences: { [KAIROS_PROMISES_PREF_KEY]: next }, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning({ userId: userPreferences.userId })
      if (inserted.length > 0) return result
    }
    throw new Error('kairos-promises: could not lock the preferences row')
  })
}

// ── Reads ────────────────────────────────────────────────────────────────

export interface KairosPromiseView {
  id: string
  number: string
  seq: number
  outcome: string
  dueDate: string
  status: KairosPromise['status']
  check: KairosPromise['check']['kind']
  source: KairosPromise['source']['kind']
  createdAt: string
  closedAt: string | null
  closedBy: NonNullable<KairosPromise['closedBy']>['kind'] | null
  renegotiations: number
}

export function toKairosPromiseView(p: KairosPromise): KairosPromiseView {
  return {
    id: p.id,
    number: `P${p.seq}`,
    seq: p.seq,
    outcome: p.outcome,
    dueDate: p.dueDate,
    status: p.status,
    check: p.check.kind,
    source: p.source.kind,
    createdAt: p.createdAt,
    closedAt: p.closedAt ?? null,
    closedBy: p.closedBy?.kind ?? null,
    renegotiations: p.renegotiations,
  }
}

// Open promises by P-number; scope 'all' appends the closed history (newest first).
export async function listKairosPromises(userId: string, input: ListKairosPromisesInput): Promise<KairosPromise[]> {
  const state = await readKairosPromises(userId)
  const open = [...state.open].sort((a, b) => a.seq - b.seq)
  return input.scope === 'all' ? [...open, ...state.closed] : open
}

// The P-number lookup ("P3 kept"): the open promise numbered `seq`, or null.
export async function findOpenKairosPromiseBySeq(userId: string, seq: number): Promise<KairosPromise | null> {
  const state = await readKairosPromises(userId)
  return state.open.find((p) => p.seq === seq) ?? null
}

export interface PromiseTaskRow {
  id: string
  projectId: string
  status: string
  completedAt: Date | null
  archivedAt: Date | null
  columnName: string | null
}

export async function findPromiseTask(taskId: string): Promise<PromiseTaskRow | null> {
  const [row] = await db
    .select({
      id: boardTasks.id,
      projectId: boardTasks.projectId,
      status: boardTasks.status,
      completedAt: boardTasks.completedAt,
      archivedAt: boardTasks.archivedAt,
      columnName: boardColumns.name,
    })
    .from(boardTasks)
    .leftJoin(boardColumns, eq(boardColumns.id, boardTasks.columnId))
    .where(eq(boardTasks.id, taskId))
    .limit(1)
  return row ?? null
}

export interface PromiseDoneEvent {
  id: string
  entityId: string
  projectId: string
  actorId: string | null
  actorType: string
  createdAt: Date
}

// Card-done evidence for the daily check: a task completed or vaulted, or
// moved into a column named like a done/vault column, since `since`. Oldest first.
export async function listPromiseDoneEvents(
  taskIds: string[],
  since: Date,
  doneColumnNames: readonly string[],
): Promise<PromiseDoneEvent[]> {
  if (taskIds.length === 0) return []
  const names = sql.join(doneColumnNames.map((n) => sql`${n}`), sql`, `)
  return db
    .select({
      id: activityEvents.id,
      entityId: activityEvents.entityId,
      projectId: activityEvents.projectId,
      actorId: activityEvents.actorId,
      actorType: activityEvents.actorType,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .leftJoin(boardColumns, sql`${boardColumns.id}::text = ${activityEvents.metadata}->>'toColumnId'`)
    .where(and(
      eq(activityEvents.entityType, 'task'),
      inArray(activityEvents.entityId, taskIds),
      gte(activityEvents.createdAt, since),
      sql`(${activityEvents.action} in ('completed', 'vaulted') or (${activityEvents.action} = 'moved' and lower(trim(${boardColumns.name})) in (${names})))`,
    ))
    .orderBy(asc(activityEvents.createdAt))
}
