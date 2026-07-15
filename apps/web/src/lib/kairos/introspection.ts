import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, dominions } from '@/lib/db/schema'
import { findDominionsByUser, inspectDominion } from '@/lib/data/dominions'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import {
  INTROSPECTION_SYSTEM_PROMPT,
  buildIntrospectionUserPrompt,
  extractJsonBlock,
  introspectionOutSchema,
  filterGroundedProposals,
  type IntrospectionContext,
  type IntrospectionMemoryRow,
} from './introspection-prompt'
import { todayIso } from './_prompt-utils'
import { writeCronFailureTrace } from './cron-trace'

// ─────────────────────────────────────────────────────────────────────────
// Kairos — Guided Introspection runner (propose-not-commit).
//
// Per active Dominion: read recent substrate + cortex, ask the model for a
// handful of grounded proposals, and write each as a STAGED `type='inbound'`
// memory carrying its citations as `refers_to` provenance links. Proposals are
// never canonical beliefs — the operator commits via kairos_reflect and
// dismisses via archive. This is L1 on the autonomy gradient: generation is
// cheap, commitment is gated, every thought is evidence-cited.
//
// Mirrors cortex.ts: idempotent per UTC day, graceful skips on missing/
// undecryptable BYOK keys, never bricks a Dominion on a failed run.
// ─────────────────────────────────────────────────────────────────────────

const RECENT_MEMORY_LIMIT = 30
const PROPOSAL_TYPE = 'inbound'

async function alreadyRanToday(userId: string, dominionId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      eq(memories.type, PROPOSAL_TYPE),
      sql`${memories.sourceMetadata}->>'introspection' = 'true'`,
      sql`${memories.createdAt} >= DATE_TRUNC('day', NOW())`,
    ))
  return (row?.n ?? 0) > 0
}

async function fetchCortexBody(userId: string, dominionId: string): Promise<string | null> {
  const [row] = await db
    .select({ bodyMd: memories.bodyMd })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      eq(memories.streamClass, 'cortex'),
      isNull(memories.archivedAt),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(1)
  return row?.bodyMd ?? null
}

export async function gatherIntrospectionContext(
  userId: string,
  dominionId: string,
): Promise<IntrospectionContext | null> {
  const briefing = await inspectDominion(dominionId, userId, { memoryLimit: RECENT_MEMORY_LIMIT })
  if (!briefing) return null

  const cortexBody = await fetchCortexBody(userId, dominionId)

  // Don't feed the model the proposals it (or a prior run) already wrote — that
  // would let it cite its own un-committed thoughts and compound drift.
  const recentMemories: IntrospectionMemoryRow[] = briefing.recentMemories
    .filter((m) => m.type !== PROPOSAL_TYPE)
    .map((m) => ({
      id: m.id,
      title: m.title,
      type: m.type,
      summary: m.summary ?? null,
      createdAt: m.createdAt,
    }))

  return {
    dominionId,
    name: briefing.name,
    vision: briefing.vision,
    cortexBody,
    recentMemories,
  }
}

export interface IntrospectionRunResult {
  dominionId: string
  dominionName: string
  status: 'created' | 'existing' | 'skipped' | 'error'
  proposalsCreated?: number
  reason?: string
}

export async function runIntrospectionForDominion(
  userId: string,
  dominionId: string,
): Promise<IntrospectionRunResult> {
  const [dom] = await db
    .select({ id: dominions.id, name: dominions.name, archivedAt: dominions.archivedAt })
    .from(dominions)
    .where(and(eq(dominions.id, dominionId), eq(dominions.userId, userId)))
    .limit(1)
  if (!dom) return { dominionId, dominionName: '(unknown)', status: 'error', reason: 'dominion not found' }
  if (dom.archivedAt) return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'archived' }

  if (await alreadyRanToday(userId, dominionId)) {
    return { dominionId, dominionName: dom.name, status: 'existing', reason: 'already ran today' }
  }

  const ctx = await gatherIntrospectionContext(userId, dominionId)
  if (!ctx) return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'no context' }
  if (ctx.recentMemories.length === 0) {
    return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'no recent substrate' }
  }

  const date = todayIso()
  const runId = `introspection:${dominionId}:${date}`

  let rawText: string
  try {
    const { provider } = await getProviderForTask(userId, { taskType: 'reflect', dominionId })
    const response = await provider.ask({
      system: INTROSPECTION_SYSTEM_PROMPT,
      prompt: buildIntrospectionUserPrompt(ctx, date),
      cacheSystem: true,
      maxTokens: 2000,
    })
    rawText = response.text.trim()
  } catch (err) {
    if (err instanceof AiCredentialMissingError) {
      return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'no BYOK credential' }
    }
    if (err instanceof AiCredentialDecryptError) {
      return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'key undecryptable' }
    }
    throw err
  }

  if (!rawText) {
    await writeCronFailureTrace(userId, { cronName: 'introspection', dominionId, reason: 'empty_response' })
    return { dominionId, dominionName: dom.name, status: 'error', reason: 'empty model response' }
  }

  let proposals
  try {
    const parsed = introspectionOutSchema.parse(extractJsonBlock(rawText))
    const validIds = new Set(ctx.recentMemories.map((m) => m.id))
    proposals = filterGroundedProposals(parsed, validIds)
  } catch (err) {
    await writeCronFailureTrace(userId, { cronName: 'introspection', dominionId, reason: 'parse_failed', error: err })
    return {
      dominionId,
      dominionName: dom.name,
      status: 'error',
      reason: `parse failure: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (proposals.length === 0) {
    await writeCronFailureTrace(userId, { cronName: 'introspection', dominionId, reason: 'all_thoughts_ungrounded' })
    return { dominionId, dominionName: dom.name, status: 'created', proposalsCreated: 0, reason: 'no grounded proposals' }
  }

  const now = new Date()
  const rows = proposals.map((p) => ({
    userId,
    dominionId,
    title: p.title.slice(0, 255),
    bodyMd: p.body,
    summary: p.title.slice(0, 240),
    type: PROPOSAL_TYPE,
    // Agentic stream — these are Kairos's own thoughts, weighted BELOW the
    // operator's reflections in synthesis until promoted.
    streamClass: 'agentic' as const,
    source: 'cron',
    sourceMetadata: {
      introspection: true,
      kind: p.kind,
      confidence: p.confidence,
      citations: p.citations,
      runId,
      status: 'pending',
    },
    // Provenance: every proposal links to the memories it was derived from, so
    // the graph shows the evidence trail and the operator can trace the claim.
    links: p.citations.map((target) => ({ type: 'refers_to', target, target_kind: 'memory' as const })),
    tags: ['proposal', p.kind],
    pinned: false,
    createdAt: now,
  }))

  await db.insert(memories).values(rows)

  return { dominionId, dominionName: dom.name, status: 'created', proposalsCreated: rows.length }
}

export async function runIntrospectionForUser(userId: string): Promise<IntrospectionRunResult[]> {
  const all = await findDominionsByUser(userId)
  const active = all.filter((d) => !d.archivedAt)
  const results: IntrospectionRunResult[] = []
  for (const dom of active) {
    try {
      results.push(await runIntrospectionForDominion(userId, dom.id))
    } catch (err) {
      await writeCronFailureTrace(userId, {
        cronName: 'introspection',
        dominionId: dom.id,
        reason: 'uncaught_exception',
        error: err,
      })
      results.push({
        dominionId: dom.id,
        dominionName: dom.name,
        status: 'error',
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return results
}
