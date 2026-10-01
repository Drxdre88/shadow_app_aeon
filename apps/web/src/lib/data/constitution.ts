import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dominionObjectives, dominions, memories, memoryOps, userAiCredentials } from '@/lib/db/schema'
import { validAsOfNow } from '@/lib/data/memories'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'
import { CONSTITUTION_OP_STEP, CONSTITUTION_PROPOSAL_KIND, CONSTITUTION_TYPE } from '@/lib/kairos/constitution/schema'
import type { EngineLink } from '@/lib/kairos/engine/types'

// Constitution persistence (docs/kairos/34 §2). Pure DB access, no auth
// (callers pass the authenticated userId; every query is user-scoped).
//
//   constitution version  type/streamClass 'constitution' — ONE live row per
//                         user (supersededAt IS NULL), versioned by supersession
//   amendment proposal    type 'inbound', sourceMetadata.kind 'constitution_amendment'
//   drift observation     lib/data/constitution-drift (re-exported below)
//
// Every constitution write serialises on one per-user advisory lock so a
// double accept or a racing seed can never produce two live versions or two
// first drafts.

export {
  findDriftObservation,
  findLatestDriftRun,
  insertDriftObservation,
  type DriftObservationKind,
  type DriftObservationRow,
  type DriftObservationValues,
} from './constitution-drift'

const LOCK_KEY = 'kairos:constitution'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function lockConstitution(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${LOCK_KEY}))`)
}

const liveConstitutionWhere = (userId: string) => and(
  eq(memories.userId, userId),
  eq(memories.type, CONSTITUTION_TYPE),
  eq(memories.streamClass, 'constitution'),
  isNull(memories.supersededAt),
  isNull(memories.archivedAt),
)

const pendingProposalWhere = (userId: string) => and(
  eq(memories.userId, userId),
  eq(memories.type, 'inbound'),
  isNull(memories.archivedAt),
  sql`${memories.sourceMetadata}->>'kind' = ${CONSTITUTION_PROPOSAL_KIND}`,
  sql`${memories.sourceMetadata}->>'status' = 'pending'`,
)

export interface ConstitutionRow {
  id: string
  title: string
  bodyMd: string
  sourceMetadata: Record<string, unknown>
  createdAt: Date
  supersededAt: Date | null
}

const CONSTITUTION_COLUMNS = {
  id: memories.id,
  title: memories.title,
  bodyMd: memories.bodyMd,
  sourceMetadata: memories.sourceMetadata,
  createdAt: memories.createdAt,
  supersededAt: memories.supersededAt,
} as const

function asRow(r: { sourceMetadata: unknown } & Omit<ConstitutionRow, 'sourceMetadata'>): ConstitutionRow {
  return { ...r, sourceMetadata: (r.sourceMetadata ?? {}) as Record<string, unknown> }
}

export async function findLiveConstitutionRow(userId: string): Promise<ConstitutionRow | null> {
  const [row] = await db
    .select(CONSTITUTION_COLUMNS)
    .from(memories)
    .where(liveConstitutionWhere(userId))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  return row ? asRow(row) : null
}

export async function listConstitutionVersionRows(userId: string, limit = 20): Promise<ConstitutionRow[]> {
  const rows = await db
    .select(CONSTITUTION_COLUMNS)
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, CONSTITUTION_TYPE),
      eq(memories.streamClass, 'constitution'),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100))
  return rows.map(asRow)
}

export async function listPendingConstitutionProposals(userId: string, limit = 20): Promise<ConstitutionRow[]> {
  const rows = await db
    .select(CONSTITUTION_COLUMNS)
    .from(memories)
    .where(pendingProposalWhere(userId))
    .orderBy(desc(memories.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100))
  return rows.map(asRow)
}

// ── Proposals ──────────────────────────────────────────────────────────────

export interface ConstitutionProposalValues {
  title: string
  bodyMd: string
  summary: string
  source: string
  links: EngineLink[]
  tags: string[]
  sourceMetadata: Record<string, unknown>
}

export type InsertProposalResult =
  | { written: true; memoryId: string }
  | { written: false; memoryId: null; skipped: 'constitution_exists' | 'pending_draft_exists' }

// Writes a pending constitution_amendment proposal. `firstDraftOnly` (the
// seed) re-checks under the lock that there is neither a live constitution
// nor any pending amendment, so repeated or racing seeds write at most one.
export async function insertConstitutionProposal(
  userId: string,
  values: ConstitutionProposalValues,
  opts: { firstDraftOnly?: boolean } = {},
): Promise<InsertProposalResult> {
  return db.transaction(async (tx) => {
    await lockConstitution(tx, userId)
    if (opts.firstDraftOnly) {
      const [live] = await tx.select({ id: memories.id }).from(memories).where(liveConstitutionWhere(userId)).limit(1)
      if (live) return { written: false, memoryId: null, skipped: 'constitution_exists' }
      const [pending] = await tx.select({ id: memories.id }).from(memories).where(pendingProposalWhere(userId)).limit(1)
      if (pending) return { written: false, memoryId: null, skipped: 'pending_draft_exists' }
    }
    const [inserted] = await tx
      .insert(memories)
      .values({
        userId,
        dominionId: null,
        title: values.title.slice(0, 255),
        bodyMd: values.bodyMd,
        summary: values.summary.slice(0, 240),
        type: 'inbound',
        // Kairos's own thought until the operator accepts it.
        streamClass: 'agentic',
        source: values.source,
        confidence: confidenceForStreamClass('agentic'),
        links: values.links,
        tags: values.tags,
        sourceMetadata: values.sourceMetadata,
        pinned: false,
      })
      .returning({ id: memories.id })
    if (!inserted) throw new Error('constitution proposal insert returned no row')
    return { written: true, memoryId: inserted.id }
  })
}

// ── Acceptance ─────────────────────────────────────────────────────────────

export interface ProposalForAccept {
  id: string
  type: string
  sourceMetadata: Record<string, unknown>
}

export interface ConstitutionVersionValues {
  version: number
  title: string
  bodyMd: string
  summary: string
  links: EngineLink[]
  sourceMetadata: Record<string, unknown>
  opReason: string
  opAfter: Record<string, unknown>
}

export type AcceptDecision<R extends string> =
  | { ok: false; reason: R }
  | { ok: true; values: ConstitutionVersionValues }

export type AcceptTxResult<R extends string> =
  | { ok: true; constitutionId: string; version: number; supersededId: string | null; alreadyApplied: boolean }
  | { ok: false; reason: R | 'not_found' }

// One transaction: (idempotency probe) → lock the proposal + the live version
// → `decide` validates and builds the new version → insert it, supersede the
// previous live version, close the proposal (accepted + archived) and log a
// memory_ops 'promote' row. A proposal already applied returns its version
// with alreadyApplied:true and writes nothing.
export async function acceptConstitutionProposalTx<R extends string>(
  userId: string,
  proposalId: string,
  decide: (proposal: ProposalForAccept, live: ConstitutionRow | null) => AcceptDecision<R>,
  now: Date = new Date(),
): Promise<AcceptTxResult<R>> {
  return db.transaction(async (tx): Promise<AcceptTxResult<R>> => {
    await lockConstitution(tx, userId)

    const [applied] = await tx
      .select({ id: memories.id, sourceMetadata: memories.sourceMetadata, supersededAt: memories.supersededAt })
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        eq(memories.type, CONSTITUTION_TYPE),
        sql`${memories.sourceMetadata}->'constitution'->>'acceptedFrom' = ${proposalId}`,
      ))
      .limit(1)
    if (applied) {
      const meta = (applied.sourceMetadata ?? {}) as { constitution?: { version?: unknown } }
      const version = typeof meta.constitution?.version === 'number' ? meta.constitution.version : 0
      return { ok: true, constitutionId: applied.id, version, supersededId: null, alreadyApplied: true }
    }

    const [proposal] = await tx
      .select({ id: memories.id, type: memories.type, sourceMetadata: memories.sourceMetadata })
      .from(memories)
      .where(and(eq(memories.id, proposalId), eq(memories.userId, userId)))
      .limit(1)
      .for('update')
    if (!proposal) return { ok: false, reason: 'not_found' }

    const [liveRaw] = await tx
      .select(CONSTITUTION_COLUMNS)
      .from(memories)
      .where(liveConstitutionWhere(userId))
      .orderBy(desc(memories.createdAt))
      .limit(1)
      .for('update')
    const live = liveRaw ? asRow(liveRaw) : null

    const decision = decide(
      { id: proposal.id, type: proposal.type, sourceMetadata: (proposal.sourceMetadata ?? {}) as Record<string, unknown> },
      live,
    )
    if (!decision.ok) return { ok: false, reason: decision.reason }
    const v = decision.values

    const [inserted] = await tx
      .insert(memories)
      .values({
        userId,
        dominionId: null,
        title: v.title.slice(0, 255),
        bodyMd: v.bodyMd,
        summary: v.summary.slice(0, 240),
        type: CONSTITUTION_TYPE,
        streamClass: 'constitution',
        source: 'manual',
        confidence: confidenceForStreamClass('constitution'),
        links: v.links,
        tags: ['constitution'],
        sourceMetadata: v.sourceMetadata,
        // Operator-owned: never decayed or machine-retired.
        pinned: true,
        validAt: now,
      })
      .returning({ id: memories.id })
    if (!inserted) throw new Error('constitution insert returned no row')

    if (live) {
      await tx
        .update(memories)
        .set({ supersededAt: now, supersededById: inserted.id, invalidAt: now, updatedAt: now })
        .where(and(eq(memories.id, live.id), eq(memories.userId, userId)))
    }

    await tx
      .update(memories)
      .set({
        sourceMetadata: {
          ...((proposal.sourceMetadata ?? {}) as Record<string, unknown>),
          status: 'accepted',
          acceptedAt: now.toISOString(),
          constitutionId: inserted.id,
        },
        archivedAt: now,
        updatedAt: now,
      })
      .where(and(eq(memories.id, proposal.id), eq(memories.userId, userId)))

    // before:null — a constitution change is undone by a further amendment,
    // never by revert_memory_op (revert refuses ops without a before snapshot).
    await tx.insert(memoryOps).values({
      userId,
      runId: null,
      memoryId: inserted.id,
      step: CONSTITUTION_OP_STEP,
      op: 'promote',
      before: null,
      after: { ...v.opAfter, supersededId: live?.id ?? null },
      reason: v.opReason,
    })

    return { ok: true, constitutionId: inserted.id, version: v.version, supersededId: live?.id ?? null, alreadyApplied: false }
  })
}

// ── Seed inputs ────────────────────────────────────────────────────────────

export interface SeedDominionRow {
  id: string
  name: string
  vision: string | null
  missionLong: string | null
  objectives: Array<{ title: string; description: string | null; status: string }>
}

export async function listSeedDominions(userId: string): Promise<SeedDominionRow[]> {
  const doms = await db
    .select({ id: dominions.id, name: dominions.name, vision: dominions.vision, missionLong: dominions.missionLong })
    .from(dominions)
    .where(and(eq(dominions.userId, userId), isNull(dominions.archivedAt)))
    .orderBy(asc(dominions.sortOrder), asc(dominions.createdAt))
  if (doms.length === 0) return []
  const objectives = await db
    .select({
      dominionId: dominionObjectives.dominionId,
      title: dominionObjectives.title,
      description: dominionObjectives.description,
      status: dominionObjectives.status,
    })
    .from(dominionObjectives)
    .where(and(
      eq(dominionObjectives.userId, userId),
      inArray(dominionObjectives.dominionId, doms.map((d) => d.id)),
      isNull(dominionObjectives.archivedAt),
      eq(dominionObjectives.status, 'active'),
    ))
    .orderBy(asc(dominionObjectives.sortOrder), asc(dominionObjectives.createdAt))
  return doms.map((d) => ({
    ...d,
    objectives: objectives
      .filter((o) => o.dominionId === d.id)
      .map((o) => ({ title: o.title, description: o.description, status: o.status })),
  }))
}

export interface TopReflectionRow {
  id: string
  title: string
  summary: string | null
}

// Highest-standing live reflections (recency breaks ties / unscored rows).
export async function listTopReflections(userId: string, limit = 20): Promise<TopReflectionRow[]> {
  return db
    .select({ id: memories.id, title: memories.title, summary: memories.summary })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.streamClass, 'reflection'),
      isNull(memories.archivedAt),
      isNull(memories.supersededAt),
      validAsOfNow,
    ))
    .orderBy(sql`${memories.standing} DESC NULLS LAST`, desc(memories.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100))
}

// Cron: users with an active Dominion and a live BYOK credential.
export async function listUsersForConstitutionSeed(): Promise<string[]> {
  const withDominions = await db
    .selectDistinct({ userId: dominions.userId })
    .from(dominions)
    .where(isNull(dominions.archivedAt))
  if (withDominions.length === 0) return []
  const credentialed = await db
    .selectDistinct({ userId: userAiCredentials.userId })
    .from(userAiCredentials)
    .where(and(isNull(userAiCredentials.revokedAt), inArray(userAiCredentials.userId, withDominions.map((r) => r.userId))))
  return credentialed.map((r) => r.userId)
}
