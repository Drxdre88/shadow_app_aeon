import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, dominions } from '@/lib/db/schema'
import { findDominionsByUser, inspectDominion } from '@/lib/data/dominions'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import {
  ARCHETYPE_SYSTEM_PROMPT,
  archetypeOutSchema,
  buildArchetypePrompt,
  buildArchetypeUserPrompt,
  extractJsonBlock,
  RECENT_WINDOW_DAYS,
  type ArchetypeContext,
  type ArchetypeOutput,
  type SubstrateRow,
} from './archetypes-prompt'
import { todayIso } from './_prompt-utils'
import { writeCronFailureTrace } from './cron-trace'

// Re-export for callers (cron route + tests) that only import this module.
export {
  archetypeOutSchema,
  buildArchetypePrompt,
  extractJsonBlock,
  type ArchetypeContext,
  type ArchetypeOutput,
}

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (B1) — Archetype Generator.
//
// Per active Dominion per user, synthesise 3–7 master-node memories that
// summarise *what's shaping this Dominion right now*. Substrate read:
//   - last 14 days of non-pinned, non-archetype memories (≤80)
//   - pinned memories (≤30, any age)
//   - reflections (any age, weighted higher in the prompt)
//   - existing live archetypes (continuity hint, ≤10)
//   - dominion vision + mission + open objectives + open board cards
//
// Output: 3–7 archetype rows (streamClass='archetype', type='archetype'),
// each with title / one-line summary / 100–800 char body / 1–5 themes /
// 0–N cited memory ids. Soft-archives prior non-pinned archetypes for
// the Dominion at the start of the run. Pinned archetypes are kept.
//
// Idempotency: skip a Dominion if any archetype memory already exists
// for it created today (UTC). Mirrors the Briefer's daily-no-op pattern.
//
// See docs/kairos/12-kairos-evolution-plan.md §"Phase 1B" and
// docs/kairos/14-quality-gates.md §5 (reflection weight).
// ─────────────────────────────────────────────────────────────────────────

const MAX_RECENT = 80
const MAX_PINNED = 30
const MAX_REFLECTIONS = 30
const MAX_EXISTING = 10

async function alreadyRanToday(userId: string, dominionId: string): Promise<boolean> {
  // Filter on isNull(archivedAt) so a previously-failed run (which archived
  // yesterday's archetypes but never wrote new ones) does NOT permanently
  // skip the Dominion. Only live archetypes created today count as "ran".
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      eq(memories.streamClass, 'archetype'),
      isNull(memories.archivedAt),
      sql`${memories.createdAt} >= DATE_TRUNC('day', NOW())`,
    ))
  return (row?.n ?? 0) > 0
}

async function fetchSubstrate(userId: string, dominionId: string) {
  const baseScope = and(
    eq(memories.userId, userId),
    eq(memories.dominionId, dominionId),
    isNull(memories.archivedAt),
  )
  const cols = {
    id: memories.id,
    title: memories.title,
    type: memories.type,
    streamClass: memories.streamClass,
    summary: memories.summary,
    pinned: memories.pinned,
    createdAt: memories.createdAt,
  }

  const [recent, pinned, reflections, existing] = await Promise.all([
    db.select(cols).from(memories).where(and(
      baseScope,
      eq(memories.pinned, false),
      ne(memories.streamClass, 'reflection'),
      ne(memories.streamClass, 'archetype'),
      ne(memories.streamClass, 'cortex'),
      sql`${memories.createdAt} > NOW() - (${RECENT_WINDOW_DAYS}::int * INTERVAL '1 day')`,
    )).orderBy(desc(memories.createdAt)).limit(MAX_RECENT),

    db.select(cols).from(memories).where(and(
      baseScope,
      eq(memories.pinned, true),
      ne(memories.streamClass, 'archetype'),
      ne(memories.streamClass, 'cortex'),
    )).orderBy(desc(memories.createdAt)).limit(MAX_PINNED),

    db.select(cols).from(memories).where(and(
      baseScope,
      eq(memories.streamClass, 'reflection'),
    )).orderBy(desc(memories.createdAt)).limit(MAX_REFLECTIONS),

    db.select(cols).from(memories).where(and(
      baseScope,
      eq(memories.streamClass, 'archetype'),
    )).orderBy(desc(memories.createdAt)).limit(MAX_EXISTING),
  ])

  return { recent, pinned, reflections, existing }
}

export async function gatherArchetypeContext(
  userId: string,
  dominionId: string,
): Promise<ArchetypeContext | null> {
  const briefing = await inspectDominion(dominionId, userId, { memoryLimit: 1, boardTaskLimit: 20 })
  if (!briefing) return null

  const substrate = await fetchSubstrate(userId, dominionId)

  return {
    dominionId,
    name: briefing.name,
    vision: briefing.vision,
    missionLong: briefing.missionLong,
    objectives: briefing.objectives.map((o) => ({
      title: o.title,
      description: o.description,
      status: o.status,
    })),
    boardTasks: briefing.boardTasks.map((t) => ({
      name: t.name,
      status: t.status,
      priority: t.priority,
      projectName: t.projectName,
    })),
    ...substrate,
  }
}

interface PersistResult {
  inserted: number
  archivedPrior: number
  archetypeMemoryIds: string[]
}

async function persistArchetypes(
  userId: string,
  ctx: ArchetypeContext,
  parsed: ArchetypeOutput,
  runId: string,
): Promise<PersistResult> {
  const now = new Date()

  const rows = parsed.archetypes.map((a) => ({
    userId,
    dominionId: ctx.dominionId,
    title: a.title.slice(0, 255),
    bodyMd: a.body,
    summary: a.summary.slice(0, 1000),
    type: 'archetype' as const,
    streamClass: 'archetype' as const,
    source: 'cron' as const,
    sourceMetadata: {
      runId,
      runDate: runId.split(':').pop() ?? null,
      dominionId: ctx.dominionId,
      citedMemoryIds: a.citedMemoryIds,
      themes: a.themes,
      shifts: parsed.shifts,
    },
    tags: a.themes.slice(0, 50),
    pinned: false,
  }))

  // Atomic archive + insert. If insert fails, the archive rolls back so we
  // never leave the Dominion with zero live archetypes (which would brick
  // the alreadyRanToday short-circuit and look like "ran but empty").
  return db.transaction(async (tx) => {
    const archived = await tx
      .update(memories)
      .set({ archivedAt: now })
      .where(and(
        eq(memories.userId, userId),
        eq(memories.dominionId, ctx.dominionId),
        eq(memories.streamClass, 'archetype'),
        eq(memories.pinned, false),
        isNull(memories.archivedAt),
      ))
      .returning({ id: memories.id })

    const inserted = rows.length === 0
      ? []
      : await tx.insert(memories).values(rows).returning({ id: memories.id })

    return {
      inserted: inserted.length,
      archivedPrior: archived.length,
      archetypeMemoryIds: inserted.map((r) => r.id),
    }
  })
}

export interface ArchetypeRunResult {
  dominionId: string
  dominionName: string
  status: 'created' | 'existing' | 'skipped' | 'error'
  archetypeMemoryIds?: string[]
  archivedPrior?: number
  reason?: string
}

export async function runArchetypeSynthesisForDominion(
  userId: string,
  dominionId: string,
): Promise<ArchetypeRunResult> {
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

  const ctx = await gatherArchetypeContext(userId, dominionId)
  if (!ctx) return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'no context' }

  // If a Dominion has zero substrate AND zero reflections AND zero vision,
  // there's nothing to synthesise. Skip rather than hallucinate.
  const hasSignal = ctx.recent.length + ctx.pinned.length + ctx.reflections.length > 0
    || Boolean(ctx.vision) || Boolean(ctx.missionLong)
  if (!hasSignal) {
    return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'empty substrate' }
  }

  const date = todayIso()
  const runId = `archetype:${dominionId}:${date}`

  let rawText: string
  try {
    const { provider } = await getProviderForTask(userId, { taskType: 'archetype', dominionId })
    const response = await provider.ask({
      system: ARCHETYPE_SYSTEM_PROMPT,
      prompt: buildArchetypeUserPrompt(ctx, date),
      cacheSystem: true,
      maxTokens: 3000,
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
    await writeCronFailureTrace(userId, { cronName: 'archetype-synthesis', dominionId, reason: 'empty_response' })
    return { dominionId, dominionName: dom.name, status: 'error', reason: 'empty model response' }
  }

  let parsed: ArchetypeOutput
  try {
    const json = extractJsonBlock(rawText)
    parsed = archetypeOutSchema.parse(json)
  } catch (err) {
    await writeCronFailureTrace(userId, { cronName: 'archetype-synthesis', dominionId, reason: 'parse_failed', error: err })
    return {
      dominionId,
      dominionName: dom.name,
      status: 'error',
      reason: `parse failure: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const { inserted, archivedPrior, archetypeMemoryIds } = await persistArchetypes(userId, ctx, parsed, runId)

  if (inserted === 0) {
    await writeCronFailureTrace(userId, { cronName: 'archetype-synthesis', dominionId, reason: 'persist_failed' })
  }

  return {
    dominionId,
    dominionName: dom.name,
    status: inserted > 0 ? 'created' : 'error',
    archetypeMemoryIds,
    archivedPrior,
    reason: inserted === 0 ? 'no archetypes emitted' : undefined,
  }
}

export async function runArchetypeSynthesisForUser(userId: string): Promise<ArchetypeRunResult[]> {
  const all = await findDominionsByUser(userId)
  const active = all.filter((d) => !d.archivedAt)
  const results: ArchetypeRunResult[] = []
  for (const dom of active) {
    try {
      results.push(await runArchetypeSynthesisForDominion(userId, dom.id))
    } catch (err) {
      await writeCronFailureTrace(userId, {
        cronName: 'archetype-synthesis',
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

