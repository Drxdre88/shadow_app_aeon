import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, dominions } from '@/lib/db/schema'
import { findDominionsByUser, inspectDominion } from '@/lib/data/dominions'
import { skipForFocus } from '@/lib/data/dominion-focus'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import {
  CORTEX_SYSTEM_PROMPT,
  buildCortexPrompt,
  buildCortexUserPrompt,
  cortexGenSchema,
  cortexOutSchema,
  extractJsonBlock,
  groundCortexOutput,
  renderCortexMarkdown,
  type CortexContext,
  type CortexOutput,
} from './cortex-prompt'
import { todayIso, parseWithRepair, ParseRepairError } from './_prompt-utils'
import { writeCronFailureTrace, writeCronSuccessTrace } from './cron-trace'
import { cortexDueSoonContext } from './surprise/replay-reader'
import { fetchCortexInputs, fetchTodaySoFar, previousUtcDay } from './cortex-inputs'

export {
  buildCortexPrompt,
  cortexOutSchema,
  extractJsonBlock,
  previousUtcDay,
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
// BEFORE 07:00 UTC Briefer.
// ─────────────────────────────────────────────────────────────────────────

// Exported for the thinking-queue cortex handler (lib/kairos/thinking/handlers/cortex.ts).
export async function alreadyRanToday(userId: string, dominionId: string): Promise<boolean> {
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

export async function gatherCortexContext(
  userId: string,
  dominionId: string,
): Promise<CortexContext | null> {
  const briefing = await inspectDominion(dominionId, userId, { memoryLimit: 1, boardTaskLimit: 20 })
  if (!briefing) return null

  // Sequential (not Promise.all) — keeps db.select() call order deterministic
  // for the failure-trace test suite's FIFO mock queue below.
  const inputs = await fetchCortexInputs(userId, dominionId)
  const todaySoFarDay = previousUtcDay(todayIso())
  const todaySoFar = await fetchTodaySoFar(userId, dominionId, todaySoFarDay)

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
    todaySoFar,
    todaySoFarDay: todaySoFar ? todaySoFarDay : null,
    ...(await cortexDueSoonContext(userId, dominionId)), // replay, after the sequential reads
  }
}

interface PersistResult {
  cortexMemoryId: string | null
  archivedPrior: number
}

// Exported for the thinking-queue cortex handler. `extraMetadata` carries
// queue provenance (thinkingJobId, answeredBy); the cron passes nothing.
export async function persistCortex(
  userId: string,
  ctx: CortexContext,
  payload: CortexOutput,
  runId: string,
  today: string,
  extraMetadata: Record<string, unknown> = {},
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
          ...extraMetadata,
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
    await writeCronSuccessTrace(userId, { cronName: 'cortex-regen', dominionId, outcome: 'skipped', skipReason: 'already ran today' })
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

  let rawText: string
  let finishReason: string | undefined
  let provider: Awaited<ReturnType<typeof getProviderForTask>>['provider']
  try {
    ;({ provider } = await getProviderForTask(userId, { taskType: 'cortex', dominionId }))
    const response = await provider.ask({
      system: CORTEX_SYSTEM_PROMPT,
      prompt: buildCortexUserPrompt(ctx, date),
      cacheSystem: true,
      maxTokens: 8000,
    })
    rawText = response.text.trim()
    finishReason = response.finishReason
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
    await writeCronFailureTrace(userId, { cronName: 'cortex-regen', dominionId, reason: 'empty_response', finishReason })
    return { dominionId, dominionName: dom.name, status: 'error', reason: 'empty model response' }
  }

  let parsed: CortexOutput
  const archetypeIds = ctx.archetypes.map((a) => a.id)
  try {
    parsed = await parseWithRepair({
      provider,
      rawText,
      parse: (text) => groundCortexOutput(cortexGenSchema.parse(extractJsonBlock(text)), archetypeIds),
      generatorLabel: 'cortex',
      maxTokens: 8000,
      system: CORTEX_SYSTEM_PROMPT,
      repairContext: [
        'Valid archetype ids for activeThreads[].id — copy one in full or omit the field:',
        ...(archetypeIds.length ? archetypeIds.map((id) => `- ${id}`) : ['(none — omit every id)']),
      ].join('\n'),
    })
  } catch (err) {
    if (err instanceof ParseRepairError) {
      await writeCronFailureTrace(userId, {
        cronName: 'cortex-regen',
        dominionId,
        reason: `parse_failed:${err.kind}`,
        error: err,
        finishReason,
        rawExcerpt: err.rawExcerpt,
      })
      return { dominionId, dominionName: dom.name, status: 'error', reason: err.message }
    }
    throw err
  }

  const { cortexMemoryId, archivedPrior } = await persistCortex(userId, ctx, parsed, runId, date)

  if (!cortexMemoryId) {
    await writeCronFailureTrace(userId, { cronName: 'cortex-regen', dominionId, reason: 'persist_failed' })
  } else {
    await writeCronSuccessTrace(userId, { cronName: 'cortex-regen', dominionId })
  }

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
  const active = (await findDominionsByUser(userId)).filter((d) => !d.archivedAt && !skipForFocus(d))
  const results: CortexRunResult[] = []
  for (const dom of active) {
    try {
      results.push(await runCortexRegenForDominion(userId, dom.id))
    } catch (err) {
      await writeCronFailureTrace(userId, {
        cronName: 'cortex-regen',
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
