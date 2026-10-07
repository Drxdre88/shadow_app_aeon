import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { boardColumns, boardTasks, memories } from '@/lib/db/schema'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'
import { CARD_GARDEN_KIND, readCardGarden, type CardGardenAction, type CardGardenPick } from '@/lib/kairos/card-garden/types'
import { planCardGardenStep, type CardGardenNote } from '@/lib/kairos/card-garden/step'

// Card garden proposals (Workforce Phase 3). Pure DB, no business rules. Rows
// are type 'inbound', streamClass 'trace' (out of retrieval and every Vorath
// prompt; INTERNAL_KINDS refuses the kind on public create paths), tags
// ['proposal', 'card_garden'], one card each. Top-level sourceMetadata.status
// is the claim: pending → approved | vetoed | expired, each a compare-and-set.

export type CardGardenStatus = 'pending' | 'approved' | 'vetoed' | 'expired'

const kindIs = sql`${memories.sourceMetadata}->>'kind' = ${CARD_GARDEN_KIND}`
const statusIs = (s: CardGardenStatus) => sql`${memories.sourceMetadata}->>'status' = ${s}`
const expiresAt = sql`(${memories.sourceMetadata}->>'expiresAt')::timestamptz`
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`
const scope = (userId: string) => and(eq(memories.userId, userId), eq(memories.type, 'inbound'), eq(memories.streamClass, 'trace'), kindIs)!

export interface CardGardenProposalInsert {
  externalKey: string
  title: string
  bodyMd: string
  pick: CardGardenPick
  expiresAt: string
  jobId: string
  now: Date
}

// Idempotent per externalKey (advisory lock + check, like card trees).
export async function insertCardGardenProposal(userId: string, input: CardGardenProposalInsert): Promise<{ id: string; written: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${input.externalKey}))`)
    const [existing] = await tx
      .select({ id: memories.id })
      .from(memories)
      .where(and(scope(userId), sql`${memories.sourceMetadata}->>'externalKey' = ${input.externalKey}`))
      .limit(1)
    if (existing) return { id: existing.id, written: false }
    const [row] = await tx
      .insert(memories)
      .values({
        userId,
        dominionId: null,
        title: input.title.slice(0, 255),
        bodyMd: input.bodyMd,
        summary: (input.pick.reason || input.title).slice(0, 240),
        type: 'inbound',
        streamClass: 'trace',
        source: 'cron',
        confidence: confidenceForStreamClass('trace'),
        links: [],
        tags: ['proposal', CARD_GARDEN_KIND],
        sourceMetadata: {
          kind: CARD_GARDEN_KIND,
          status: 'pending',
          externalKey: input.externalKey,
          expiresAt: input.expiresAt,
          jobId: input.jobId,
          projectId: input.pick.projectId,
          taskId: input.pick.taskId,
          cardGarden: input.pick,
        },
        pinned: false,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning({ id: memories.id })
    if (!row) throw new Error('card garden proposal insert returned no row')
    return { id: row.id, written: true }
  })
}

export interface CardGardenProposalRow {
  id: string
  title: string
  status: string
  expiresAt: string
  hasTelegram: boolean
  pick: CardGardenPick
}

export async function findCardGardenProposal(userId: string, id: string): Promise<CardGardenProposalRow | null> {
  const [row] = await db
    .select({ id: memories.id, title: memories.title, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(eq(memories.id, id), scope(userId)))
    .limit(1)
  if (!row) return null
  const meta = (row.sourceMetadata ?? {}) as Record<string, unknown>
  const pick = readCardGarden(meta)
  if (!pick) return null
  return {
    id: row.id,
    title: row.title,
    status: typeof meta.status === 'string' ? meta.status : '',
    expiresAt: typeof meta.expiresAt === 'string' ? meta.expiresAt : '',
    hasTelegram: Boolean(meta.telegram && typeof meta.telegram === 'object'),
    pick,
  }
}

// Pending, unexpired card garden proposals, for the inbox (listMemories hides 'trace').
export async function listPendingCardGardens(userId: string, now: Date, limit = 10) {
  return db
    .select({ id: memories.id, title: memories.title, summary: memories.summary, createdAt: memories.createdAt, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(scope(userId), statusIs('pending'), sql`${memories.archivedAt} IS NULL`, sql`${expiresAt} > ${ts(now)}`))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
}

// Cards proposed since `since` and not left to expire (pending, approved or
// vetoed): the gardener does not raise the same card again so soon.
export async function listRecentCardGardenTaskIds(userId: string, since: Date): Promise<Set<string>> {
  const rows = await db
    .select({ taskId: sql<string | null>`${memories.sourceMetadata}->>'taskId'` })
    .from(memories)
    .where(and(scope(userId), gte(memories.createdAt, since), sql`${memories.sourceMetadata}->>'status' <> 'expired'`))
  return new Set(rows.map((r) => r.taskId).filter((t): t is string => Boolean(t)))
}

function statusPatch(to: CardGardenStatus, now: Date, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ status: to, decidedAt: now.toISOString(), ...extra })
}

// Compare-and-set on the top-level status. False = the row was not `from`.
export async function casCardGardenStatus(userId: string, id: string, from: CardGardenStatus, to: CardGardenStatus, now: Date): Promise<boolean> {
  const rows = await db
    .update(memories)
    .set({ sourceMetadata: sql`${memories.sourceMetadata} || ${statusPatch(to, now)}::jsonb`, updatedAt: now })
    .where(and(eq(memories.id, id), scope(userId), statusIs(from)))
    .returning({ id: memories.id })
  return rows.length > 0
}

// Pending past expiry → expired (no reaction). Returns the ids it moved.
export async function expireCardGardens(userId: string, now: Date): Promise<string[]> {
  const rows = await db
    .update(memories)
    .set({ sourceMetadata: sql`${memories.sourceMetadata} || ${statusPatch('expired', now)}::jsonb`, updatedAt: now })
    .where(and(scope(userId), statusIs('pending'), sql`${expiresAt} <= ${ts(now)}`))
    .returning({ id: memories.id })
  return rows.map((r) => r.id)
}

export interface CardGardenOutcome {
  action: CardGardenAction
  wrote: boolean
  note: CardGardenNote
  taskName: string
  fromColumnId: string | null
  toColumnId: string | null
}

export type ApplyCardGardenResult = { ok: true; outcome: CardGardenOutcome } | { ok: false; reason: 'already_decided' }

/**
 * The approved action in ONE transaction: the proposal's pending → approved
 * claim (unexpired only), at most one write to the card (planCardGardenStep),
 * and the outcome stamped on the proposal. A merge never writes to the board.
 */
export async function applyCardGardenDecision(userId: string, id: string, pick: CardGardenPick, now: Date): Promise<ApplyCardGardenResult> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(memories)
      .set({ sourceMetadata: sql`${memories.sourceMetadata} || ${statusPatch('approved', now)}::jsonb`, updatedAt: now })
      .where(and(eq(memories.id, id), scope(userId), statusIs('pending'), sql`${expiresAt} > ${ts(now)}`))
      .returning({ id: memories.id })
    if (claimed.length === 0) return { ok: false as const, reason: 'already_decided' as const }

    const [task] = await tx
      .select({ id: boardTasks.id, name: boardTasks.name, status: boardTasks.status, columnId: boardTasks.columnId })
      .from(boardTasks)
      .where(and(eq(boardTasks.id, pick.taskId), eq(boardTasks.projectId, pick.projectId), isNull(boardTasks.archivedAt)))
      .limit(1)
      .for('update')
    const columns = task && (pick.action === 'park' || pick.action === 'finish')
      ? await tx
        .select({ id: boardColumns.id, name: boardColumns.name })
        .from(boardColumns)
        .where(eq(boardColumns.projectId, pick.projectId))
        .orderBy(asc(boardColumns.orderIndex))
      : []
    const step = planCardGardenStep(pick.action, task ?? null, columns)
    const where = and(eq(boardTasks.id, pick.taskId), eq(boardTasks.projectId, pick.projectId))
    if (step.write.kind === 'archive') await tx.update(boardTasks).set({ archivedAt: now }).where(where)
    else if (step.write.kind === 'move') await tx.update(boardTasks).set({ columnId: step.write.columnId, updatedAt: now }).where(where)
    else if (step.write.kind === 'finish') {
      await tx.update(boardTasks).set({ status: 'done', completedAt: now, columnId: step.write.columnId, updatedAt: now }).where(where)
    }

    const outcome: CardGardenOutcome = {
      action: pick.action,
      wrote: step.write.kind !== 'none',
      note: step.note,
      taskName: task?.name ?? pick.taskName,
      fromColumnId: task?.columnId ?? null,
      toColumnId: step.toColumnId,
    }
    await tx
      .update(memories)
      .set({ sourceMetadata: sql`${memories.sourceMetadata} || ${JSON.stringify({ applied: { ...outcome, at: now.toISOString() } })}::jsonb` })
      .where(and(eq(memories.id, id), scope(userId)))
    return { ok: true as const, outcome }
  })
}