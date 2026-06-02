import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, dominions } from '@/lib/db/schema'
import { findDominionsByUser, inspectDominion } from '@/lib/data/dominions'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError } from '@/lib/ai/router'
import {
  buildCortexPrompt,
  cortexOutSchema,
  extractJsonBlock,
  renderCortexMarkdown,
  type ArchetypeRow,
  type CortexContext,
  type CortexOutput,
  type PriorCortexRow,
  type ReflectionRow,
} from './cortex-prompt'
import { todayIso } from './_prompt-utils'

export {
  buildCortexPrompt,
  cortexOutSchema,
  extractJsonBlock,
  renderCortexMarkdown,
  type CortexContext,
  type CortexOutput,
}

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (B2) — Dominion Cortex Regeneration.
//
// Per active Dominion per user, regenerate ONE living cortex document that
// summarises *what this Dominion is shaping right now*. Substrate read:
//   - dominion vision + mission + open objectives + open board cards (live)
//   - all-time reflections (highest weight, weighted in prompt)
//   - today's live archetypes (the freshly-synthesised B1 output)
//   - prior cortex snapshot (yesterday's reading, for recent_shifts detection)
//
// Output: one memory row (streamClass='cortex', type='dominion_cortex')
// with the rendered markdown in bodyMd and the structured payload in
// sourceMetadata.cortex. Old cortex rows are soft-archived in a tx so the
// Dominion is never left without a live cortex on a failed insert.
//
// Idempotency: skip a Dominion if a LIVE cortex row already exists for it
// today (UTC). Mirrors B1's pattern — a failed run that archived yesterday
// but never wrote today does NOT permanently brick the regen path.
//
// Suggested cron: 03:00 UTC daily, AFTER 02:30 UTC archetype synthesis,
// BEFORE 07:00 UTC Briefer. Cron wiring in vercel.json is out of scope.
// ─────────────────────────────────────────────────────────────────────────

const MAX_REFLECTIONS = 30
const MAX_ARCHETYPES = 12

async function alreadyRanToday(userId: string, dominionId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      eq(memories.streamClass, 'cortex'),
      isNull(memories.archivedAt),
      sql`${memories.createdAt} >= DATE_TRUNC('day', NOW())`,
    ))
  return (row?.n ?? 0) > 0
}

async function fetchCortexInputs(
  userId: string,
  dominionId: string,
): Promise<{ reflections: ReflectionRow[]; archetypes: ArchetypeRow[]; prior: PriorCortexRow | null }> {
  const baseScope = and(
    eq(memories.userId, userId),
    eq(memories.dominionId, dominionId),
    isNull(memories.archivedAt),
  )

  const [reflectionRows, archetypeRows, priorRows] = await Promise.all([
    db.select({
      id: memories.id,
      title: memories.title,
      summary: memories.summary,
      createdAt: memories.createdAt,
    })
      .from(memories)
      .where(and(baseScope, eq(memories.streamClass, 'reflection')))
      .orderBy(desc(memories.createdAt))
      .limit(MAX_REFLECTIONS),

    db.select({
      id: memories.id,
      title: memories.title,
      summary: memories.summary,
      sourceMetadata: memories.sourceMetadata,
    })
      .from(memories)
      .where(and(baseScope, eq(memories.streamClass, 'archetype')))
      .orderBy(desc(memories.createdAt))
      .limit(MAX_ARCHETYPES),

    // Prior cortex — take the most recent row regardless of archive state.
    // We rely on alreadyRanToday() to guarantee no live cortex for today
    // exists at this point, so the most-recent row is always yesterday's
    // (or older). If we filtered on archivedAt here, a first-ever regen
    // would correctly return null, but so does this query (LIMIT 1 → []).
    db.select({
      id: memories.id,
      createdAt: memories.createdAt,
      sourceMetadata: memories.sourceMetadata,
    })
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        eq(memories.dominionId, dominionId),
        eq(memories.streamClass, 'cortex'),
      ))
      .orderBy(desc(memories.createdAt))
      .limit(1),
  ])

  const reflections: ReflectionRow[] = reflectionRows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    createdAt: r.createdAt,
  }))

  const archetypes: ArchetypeRow[] = archetypeRows.map((a) => {
    const meta = (a.sourceMetadata ?? {}) as Record<string, unknown>
    const themes = Array.isArray(meta.themes) ? (meta.themes as unknown[]).filter((t): t is string => typeof t === 'string') : []
    return { id: a.id, title: a.title, summary: a.summary, themes }
  })

  const priorRow = priorRows[0]
  let prior: PriorCortexRow | null = null
  if (priorRow) {
    const meta = (priorRow.sourceMetadata ?? {}) as Record<string, unknown>
    const candidate = meta.cortex
    const parsed = candidate ? cortexOutSchema.safeParse(candidate) : null
    // Visibility on schema drift: a prior cortex that fails the current
    // schema yields payload=null, which renders as "no prior cortex" in
    // the prompt and silently zeroes recent_shifts. Warn so it shows up
    // in cron logs instead of being indistinguishable from a first regen.
    if (priorRow && candidate && parsed && !parsed.success) {
      // eslint-disable-next-line no-console
      console.warn(
        `[kairos:cortex] prior cortex row ${priorRow.id} failed schema — recent_shifts will be empty.`,
        parsed.error.issues.slice(0, 3),
      )
    }
    prior = {
      id: priorRow.id,
      createdAt: priorRow.createdAt,
      payload: parsed?.success ? parsed.data : null,
    }
  }

  return { reflections, archetypes, prior }
}

export async function gatherCortexContext(
  userId: string,
  dominionId: string,
): Promise<CortexContext | null> {
  const briefing = await inspectDominion(dominionId, userId, { memoryLimit: 1, boardTaskLimit: 20 })
  if (!briefing) return null

  const inputs = await fetchCortexInputs(userId, dominionId)

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
    ...inputs,
  }
}

interface PersistResult {
  cortexMemoryId: string | null
  archivedPrior: number
}

async function persistCortex(
  userId: string,
  ctx: CortexContext,
  payload: CortexOutput,
  runId: string,
  today: string,
): Promise<PersistResult> {
  const now = new Date()
  const body = renderCortexMarkdown(ctx, payload, today)
  const summary = payload.visionAnchor.slice(0, 1000)

  return db.transaction(async (tx) => {
    const archived = await tx
      .update(memories)
      .set({ archivedAt: now })
      .where(and(
        eq(memories.userId, userId),
        eq(memories.dominionId, ctx.dominionId),
        eq(memories.streamClass, 'cortex'),
        // Match archetypes.ts: pinned rows survive nightly archival so
        // the operator can lock-in a cortex snapshot from the UI without
        // it being silently overwritten the next night.
        eq(memories.pinned, false),
        isNull(memories.archivedAt),
      ))
      .returning({ id: memories.id })

    const [inserted] = await tx
      .insert(memories)
      .values({
        userId,
        dominionId: ctx.dominionId,
        title: `${ctx.name} cortex · ${today}`,
        bodyMd: body,
        summary,
        type: 'dominion_cortex',
        streamClass: 'cortex',
        source: 'cron',
        sourceMetadata: {
          runId,
          runDate: today,
          dominionId: ctx.dominionId,
          cortex: payload,
        },
        tags: ['cortex'],
        pinned: false,
      })
      .returning({ id: memories.id })

    return {
      cortexMemoryId: inserted?.id ?? null,
      archivedPrior: archived.length,
    }
  })
}

export interface CortexRunResult {
  dominionId: string
  dominionName: string
  status: 'created' | 'existing' | 'skipped' | 'error'
  cortexMemoryId?: string | null
  archivedPrior?: number
  reason?: string
}

export async function runCortexRegenForDominion(
  userId: string,
  dominionId: string,
): Promise<CortexRunResult> {
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

  const ctx = await gatherCortexContext(userId, dominionId)
  if (!ctx) return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'no context' }

  // Cross-job race defense: cortex runs 30 min after archetype synthesis,
  // but heavy users with many Dominions can push the archetype job past
  // its window. If this Dominion has activity signals but no archetype
  // synthesised today, bail rather than write a cortex anchored to stale
  // archetypes — tomorrow's regen will catch up with fresh data. We only
  // bail when there *is* activity to synthesise from; first-ever runs
  // (no archetypes EVER) still fall through to the hasSignal check.
  const hasActivitySignal = ctx.reflections.length > 0 || ctx.boardTasks.length > 0
  if (hasActivitySignal && ctx.archetypes.length === 0) {
    return {
      dominionId,
      dominionName: dom.name,
      status: 'skipped',
      reason: 'archetypes not synthesised today — deferring to next regen',
    }
  }

  // Need *something* to synthesise. Cortex without any archetype, reflection,
  // or vision is just hallucination — skip and let the archetype generator
  // (B1) catch up first.
  const hasSignal = ctx.archetypes.length + ctx.reflections.length > 0
    || Boolean(ctx.vision) || Boolean(ctx.missionLong)
  if (!hasSignal) {
    return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'empty substrate' }
  }

  const date = todayIso()
  const runId = `cortex:${dominionId}:${date}`
  const prompt = buildCortexPrompt(ctx, date)

  let rawText: string
  try {
    const { provider } = await getProviderForTask(userId, { taskType: 'cortex', dominionId })
    const response = await provider.ask({
      prompt,
      maxTokens: 3000,
      temperature: 0.3,
    })
    rawText = response.text.trim()
  } catch (err) {
    if (err instanceof AiCredentialMissingError) {
      return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'no BYOK credential' }
    }
    throw err
  }

  if (!rawText) {
    return { dominionId, dominionName: dom.name, status: 'error', reason: 'empty model response' }
  }

  let parsed: CortexOutput
  try {
    parsed = cortexOutSchema.parse(extractJsonBlock(rawText))
  } catch (err) {
    return {
      dominionId,
      dominionName: dom.name,
      status: 'error',
      reason: `parse failure: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const { cortexMemoryId, archivedPrior } = await persistCortex(userId, ctx, parsed, runId, date)

  return {
    dominionId,
    dominionName: dom.name,
    status: cortexMemoryId ? 'created' : 'error',
    cortexMemoryId,
    archivedPrior,
    reason: cortexMemoryId ? undefined : 'insert returned no id',
  }
}

export async function runCortexRegenForUser(userId: string): Promise<CortexRunResult[]> {
  const all = await findDominionsByUser(userId)
  const active = all.filter((d) => !d.archivedAt)
  const results: CortexRunResult[] = []
  for (const dom of active) {
    try {
      results.push(await runCortexRegenForDominion(userId, dom.id))
    } catch (err) {
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
