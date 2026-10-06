import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'
import { CARD_TREE_KIND, readCardTree, type CardTree } from '@/lib/kairos/card-tree/types'

// Card tree proposals (Workforce L4). Pure DB, no business rules. Rows are
// type 'inbound', streamClass 'trace' (out of retrieval and every Vorath
// prompt; public create paths can never set it, and INTERNAL_KINDS refuses
// the kind), tags ['proposal', 'card_tree']. Top-level sourceMetadata.status
// is the claim: pending → approved | vetoed | expired, each a compare-and-set.

export type CardTreeStatus = 'pending' | 'approved' | 'vetoed' | 'expired'
export type CardTreeTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const kindIs = sql`${memories.sourceMetadata}->>'kind' = ${CARD_TREE_KIND}`
const statusIs = (s: CardTreeStatus) => sql`${memories.sourceMetadata}->>'status' = ${s}`
const expiresAt = sql`(${memories.sourceMetadata}->>'expiresAt')::timestamptz`
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`
const scope = (userId: string) => and(eq(memories.userId, userId), eq(memories.type, 'inbound'), eq(memories.streamClass, 'trace'), kindIs)!

export interface CardTreeProposalInsert {
  externalKey: string
  title: string
  bodyMd: string
  tree: CardTree
  expiresAt: string
  jobId: string
  now: Date
}

// Idempotent per externalKey (advisory lock + check, like voice samples).
export async function insertCardTreeProposal(userId: string, input: CardTreeProposalInsert): Promise<{ id: string; written: boolean }> {
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
        summary: input.tree.goal.slice(0, 240),
        type: 'inbound',
        streamClass: 'trace',
        source: 'cron',
        confidence: confidenceForStreamClass('trace'),
        links: [],
        tags: ['proposal', CARD_TREE_KIND],
        sourceMetadata: {
          kind: CARD_TREE_KIND,
          status: 'pending',
          externalKey: input.externalKey,
          expiresAt: input.expiresAt,
          jobId: input.jobId,
          projectId: input.tree.projectId,
          cardTree: input.tree,
        },
        pinned: false,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning({ id: memories.id })
    if (!row) throw new Error('card tree proposal insert returned no row')
    return { id: row.id, written: true }
  })
}

export interface CardTreeProposalRow {
  id: string
  title: string
  status: string
  expiresAt: string
  hasTelegram: boolean
  tree: CardTree
}

function toRow(r: { id: string; title: string; sourceMetadata: unknown }): CardTreeProposalRow | null {
  const meta = (r.sourceMetadata ?? {}) as Record<string, unknown>
  const tree = readCardTree(meta)
  if (!tree) return null
  return {
    id: r.id,
    title: r.title,
    status: typeof meta.status === 'string' ? meta.status : '',
    expiresAt: typeof meta.expiresAt === 'string' ? meta.expiresAt : '',
    hasTelegram: Boolean(meta.telegram && typeof meta.telegram === 'object'),
    tree,
  }
}

export async function findCardTreeProposal(userId: string, id: string): Promise<CardTreeProposalRow | null> {
  const [row] = await db
    .select({ id: memories.id, title: memories.title, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(eq(memories.id, id), scope(userId)))
    .limit(1)
  return row ? toRow(row) : null
}

// Pending, unexpired card trees, for the inbox (listMemories hides 'trace').
export async function listPendingCardTrees(userId: string, now: Date, limit = 5) {
  return db
    .select({
      id: memories.id,
      title: memories.title,
      summary: memories.summary,
      createdAt: memories.createdAt,
      sourceMetadata: memories.sourceMetadata,
    })
    .from(memories)
    .where(and(scope(userId), statusIs('pending'), sql`${memories.archivedAt} IS NULL`, sql`${expiresAt} > ${ts(now)}`))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
}

function statusPatch(to: CardTreeStatus, now: Date, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ status: to, decidedAt: now.toISOString(), ...extra })
}

// Compare-and-set on the top-level status. False = the row was not `from`.
export async function casCardTreeStatus(userId: string, id: string, from: CardTreeStatus, to: CardTreeStatus, now: Date): Promise<boolean> {
  const rows = await db
    .update(memories)
    .set({ sourceMetadata: sql`${memories.sourceMetadata} || ${statusPatch(to, now)}::jsonb`, updatedAt: now })
    .where(and(eq(memories.id, id), scope(userId), statusIs(from)))
    .returning({ id: memories.id })
  return rows.length > 0
}

// pending → approved inside the caller's transaction (the card creation), so
// the claim and the cards commit or roll back together.
export async function claimCardTreeInTx(tx: CardTreeTx, userId: string, id: string, now: Date): Promise<boolean> {
  const rows = await tx
    .update(memories)
    .set({ sourceMetadata: sql`${memories.sourceMetadata} || ${statusPatch('approved', now)}::jsonb`, updatedAt: now })
    .where(and(eq(memories.id, id), scope(userId), statusIs('pending'), sql`${expiresAt} > ${ts(now)}`))
    .returning({ id: memories.id })
  return rows.length > 0
}

export async function stampCreatedTasksInTx(tx: CardTreeTx, userId: string, id: string, taskIds: string[]): Promise<void> {
  await tx
    .update(memories)
    .set({ sourceMetadata: sql`${memories.sourceMetadata} || ${JSON.stringify({ createdTaskIds: taskIds })}::jsonb` })
    .where(and(eq(memories.id, id), scope(userId)))
}

// Pending past expiry → expired (no reaction). Returns the ids it moved.
export async function expireCardTrees(userId: string, now: Date): Promise<string[]> {
  const rows = await db
    .update(memories)
    .set({ sourceMetadata: sql`${memories.sourceMetadata} || ${statusPatch('expired', now)}::jsonb`, updatedAt: now })
    .where(and(scope(userId), statusIs('pending'), sql`${expiresAt} <= ${ts(now)}`))
    .returning({ id: memories.id })
  return rows.map((r) => r.id)
}
