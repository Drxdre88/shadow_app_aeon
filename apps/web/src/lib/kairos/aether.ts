import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, dominions } from '@/lib/db/schema'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import { withRetry } from '@/lib/ai/retry'
import { validAsOfNow } from '@/lib/data/memories'
import { skipForFocus } from '@/lib/data/dominion-focus'
import { writeCronFailureTrace, writeCronSuccessTrace } from './cron-trace'
import {
  AETHER_SYSTEM_PROMPT,
  buildAetherUserPrompt,
  aetherOutSchema,
  aetherGenSchema,
  aetherFedMemoryIds,
  groundAetherPayload,
  previousUtcDay,
  extractJsonBlock,
  renderAetherMarkdown,
  withAetherReplay,
  type AetherContext,
  type CortexSnapshotRow,
  type GlobalReflectionRow,
  type GlobalArchetypeRow,
  type PriorAetherRow,
} from './aether-prompt'
import { todayIso, parseWithRepair, ParseRepairError } from './_prompt-utils'
import type { AetherPayload } from './aether-types'
import { loadAetherReplay, replayMetadata } from './surprise/replay-reader'

// Kairos Aether (B3) — global self-model synthesiser.
// Idempotent: skips if a live aether row already exists for today (UTC).
// Anti-drift: citations are grounded against the fed memory ids and thought
// ids are server-minted (groundAetherPayload) before persist.

const MAX_REFLECTIONS = 40
const MAX_ARCHETYPES_PER_DOMINION = 3

// Exported for the thinking-queue aether handler (lib/kairos/thinking/handlers/aether.ts).
export async function alreadyRanToday(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.streamClass, 'aether'),
      isNull(memories.archivedAt),
      sql`${memories.createdAt} >= DATE_TRUNC('day', NOW())`,
    ))
  return (row?.n ?? 0) > 0
}

const MAX_DAY_DELTAS = 8
const MAX_DAY_DELTA_CHARS = 4000

// Grounding for the day being consolidated. Aether runs ~03:15Z, so the NEW
// UTC day is empty — read the PREVIOUS UTC day's micro-consolidation deltas
// across all Dominions (chronological), else a new-memory count for that day.
// Best-effort: a null return just omits the prompt section.
async function fetchConsolidatedDayGlobal(userId: string): Promise<string | null> {
  const today = todayIso()
  const dayEnd = new Date(`${today}T00:00:00.000Z`)
  const prevDay = previousUtcDay(today)
  const dayStart = new Date(`${prevDay}T00:00:00.000Z`)

  const deltaRows = await db
    .select({ bodyMd: memories.bodyMd })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.streamClass, 'delta'),
      isNull(memories.archivedAt),
      gte(memories.createdAt, dayStart),
      lt(memories.createdAt, dayEnd),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(MAX_DAY_DELTAS)
  if (deltaRows.length > 0) {
    return deltaRows.map((r) => r.bodyMd).reverse().join('\n\n---\n\n').slice(0, MAX_DAY_DELTA_CHARS)
  }

  const [countRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      isNull(memories.archivedAt),
      sql`${memories.streamClass} NOT IN ('trace', 'delta')`,
      gte(memories.createdAt, dayStart),
      lt(memories.createdAt, dayEnd),
    ))
  const n = countRow?.n ?? 0
  return n > 0 ? `${n} new ${n === 1 ? 'memory' : 'memories'} captured on ${prevDay} across all Dominions.` : null
}

export async function fetchAetherInputs(userId: string): Promise<{
  cortexSnapshots: CortexSnapshotRow[]
  topReflections: GlobalReflectionRow[]
  archetypes: GlobalArchetypeRow[]
  prior: PriorAetherRow | null
  todaySoFar: string | null
}> {
  const activeDoms = await db
    .select({ id: dominions.id, name: dominions.name, color: dominions.color, focusState: dominions.focusState, pinned: dominions.pinned })
    .from(dominions)
    .where(and(eq(dominions.userId, userId), isNull(dominions.archivedAt)))

  const domMap = new Map(activeDoms.map((d) => [d.id, d]))

  const [cortexRows, reflectionRows, archetypeRows, priorRows] = await Promise.all([
    // Latest non-archived cortex per active Dominion — one row per Dominion.
    // We pull the most-recent row for each Dominion using a subquery-style
    // approach: order desc, distinct on dominionId is not portable in Drizzle,
    // so we fetch the top-N rows and deduplicate in JS.
    db.select({
      id: memories.id,
      dominionId: memories.dominionId,
      createdAt: memories.createdAt,
      sourceMetadata: memories.sourceMetadata,
    })
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        eq(memories.streamClass, 'cortex'),
        isNull(memories.archivedAt),
        validAsOfNow,
      ))
      .orderBy(desc(memories.createdAt))
      .limit(activeDoms.length * 3 + 10),

    db.select({
      id: memories.id,
      dominionId: memories.dominionId,
      title: memories.title,
      summary: memories.summary,
      createdAt: memories.createdAt,
    })
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        eq(memories.streamClass, 'reflection'),
        isNull(memories.archivedAt),
        validAsOfNow,
      ))
      .orderBy(desc(memories.createdAt))
      .limit(MAX_REFLECTIONS),

    db.select({
      id: memories.id,
      dominionId: memories.dominionId,
      title: memories.title,
      summary: memories.summary,
      sourceMetadata: memories.sourceMetadata,
    })
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        eq(memories.streamClass, 'archetype'),
        isNull(memories.archivedAt),
        validAsOfNow,
        sql`${memories.createdAt} >= DATE_TRUNC('day', NOW())`,
      ))
      .orderBy(desc(memories.createdAt))
      .limit(activeDoms.length * MAX_ARCHETYPES_PER_DOMINION + 5),

    db.select({
      id: memories.id,
      createdAt: memories.createdAt,
      sourceMetadata: memories.sourceMetadata,
    })
      .from(memories)
      .where(and(
        eq(memories.userId, userId),
        eq(memories.streamClass, 'aether'),
      ))
      .orderBy(desc(memories.createdAt))
      .limit(1),
  ])

  // Deduplicate cortex rows: keep the most-recent row per Dominion.
  const seenDominions = new Set<string>()
  const cortexSnapshots: CortexSnapshotRow[] = []
  for (const row of cortexRows) {
    if (!row.dominionId) continue
    if (seenDominions.has(row.dominionId)) continue
    seenDominions.add(row.dominionId)
    const dom = domMap.get(row.dominionId)
    if (!dom || skipForFocus(dom)) continue
    const meta = (row.sourceMetadata ?? {}) as Record<string, unknown>
    const cortexPayload = meta.cortex as Record<string, unknown> | undefined
    cortexSnapshots.push({
      id: row.id,
      dominionId: row.dominionId,
      dominionName: dom.name,
      dominionColor: dom.color ?? null,
      createdAt: row.createdAt,
      visionAnchor: typeof cortexPayload?.visionAnchor === 'string' ? cortexPayload.visionAnchor : null,
      currentState: Array.isArray(cortexPayload?.currentState)
        ? (cortexPayload.currentState as unknown[]).filter((s): s is string => typeof s === 'string')
        : [],
      driftSignals: Array.isArray(cortexPayload?.driftSignals)
        ? (cortexPayload.driftSignals as unknown[]).filter((s): s is string => typeof s === 'string')
        : [],
    })
  }

  const topReflections: GlobalReflectionRow[] = reflectionRows.map((r) => ({
    id: r.id,
    dominionId: r.dominionId ?? null,
    dominionName: r.dominionId ? (domMap.get(r.dominionId)?.name ?? null) : null,
    title: r.title,
    summary: r.summary,
    createdAt: r.createdAt,
  }))

  const archetypes: GlobalArchetypeRow[] = archetypeRows
    .filter((a) => a.dominionId && domMap.has(a.dominionId))
    .map((a) => {
      const dom = domMap.get(a.dominionId!)!
      const meta = (a.sourceMetadata ?? {}) as Record<string, unknown>
      const themes = Array.isArray(meta.themes)
        ? (meta.themes as unknown[]).filter((t): t is string => typeof t === 'string')
        : []
      return {
        id: a.id,
        dominionId: a.dominionId!,
        dominionName: dom.name,
        title: a.title,
        summary: a.summary,
        themes,
      }
    })

  const priorRow = priorRows[0]
  let prior: PriorAetherRow | null = null
  if (priorRow) {
    const meta = (priorRow.sourceMetadata ?? {}) as Record<string, unknown>
    const candidate = meta.aether
    const parsed = candidate ? aetherOutSchema.safeParse(candidate) : null
    if (parsed && !parsed.success) {
      console.warn(
        `[kairos:aether] prior aether row ${priorRow.id} failed schema — shifts will be empty.`,
        parsed.error.issues.slice(0, 3),
      )
    }
    prior = {
      id: priorRow.id,
      createdAt: priorRow.createdAt,
      payload: parsed?.success ? (parsed.data as AetherPayload) : null,
    }
  }

  // Sequential (not folded into the Promise.all above) — keeps db.select()
  // call order deterministic for the failure-trace test suite's FIFO mock queue.
  const todaySoFar = await fetchConsolidatedDayGlobal(userId)

  return { cortexSnapshots, topReflections, archetypes, prior, todaySoFar }
}

export async function persistAether(
  userId: string,
  payload: AetherPayload,
  runId: string,
  today: string,
  source: 'cron' | 'claude' = 'cron',
  // Provenance from the thinking queue (thinkingJobId, answeredBy); the cron
  // and commit_aether pass nothing, so their rows are unchanged.
  extraMetadata: Record<string, unknown> = {},
): Promise<{ aetherMemoryId: string | null; archivedPrior: number }> {
  const now = new Date()
  const body = renderAetherMarkdown(payload, today)
  const summary = payload.coreNarrative.slice(0, 1000)

  return db.transaction(async (tx) => {
    const archived = await tx
      .update(memories)
      .set({ archivedAt: now })
      .where(and(
        eq(memories.userId, userId),
        eq(memories.streamClass, 'aether'),
        eq(memories.pinned, false),
        isNull(memories.archivedAt),
      ))
      .returning({ id: memories.id })

    const [inserted] = await tx
      .insert(memories)
      .values({
        userId,
        dominionId: null,
        title: `Aether · ${today}`,
        bodyMd: body,
        summary,
        type: 'aether',
        streamClass: 'aether',
        source,
        sourceMetadata: {
          ...extraMetadata,
          runId,
          runDate: today,
          aether: payload,
        },
        tags: ['aether'],
        pinned: false,
      })
      .returning({ id: memories.id })

    return {
      aetherMemoryId: inserted?.id ?? null,
      archivedPrior: archived.length,
    }
  })
}

// Returns a `reason` on every path so the cron logs WHY a run produced nothing
// instead of an undiagnosable `generated: 0`. Runs on the `aether` task type
// (heavy tier — Opus, like cortex/archetypes) and sends NO temperature: Opus
// 4.7/4.8 reject sampling params with a 400, and the strict aether schema is
// far more reliably satisfied by the heavy model than by the standard tier.
export async function runAetherForUser(userId: string): Promise<{ generated: boolean; reason: string }> {
  if (await alreadyRanToday(userId)) {
    await writeCronSuccessTrace(userId, { cronName: 'aether-regen', outcome: 'skipped', skipReason: 'already_ran' })
    return { generated: false, reason: 'already_ran' }
  }

  const inputs = await fetchAetherInputs(userId)

  const hasSignal =
    inputs.cortexSnapshots.length > 0 ||
    inputs.topReflections.length > 0 ||
    inputs.archetypes.length > 0

  if (!hasSignal) {
    return { generated: false, reason: 'no_signal' }
  }

  const today = todayIso()
  const replay = await loadAetherReplay(userId, new Date(), inputs.prior)
  const ctx: AetherContext = withAetherReplay({ userId, today, ...inputs }, replay)

  let rawText: string
  let finishReason: string | undefined
  let provider: Awaited<ReturnType<typeof getProviderForTask>>['provider']
  try {
    ;({ provider } = await getProviderForTask(userId, { taskType: 'aether' }))
    const response = await withRetry(() => provider.ask({
      system: AETHER_SYSTEM_PROMPT,
      prompt: buildAetherUserPrompt(ctx),
      cacheSystem: true,
      maxTokens: 10000,
    }))
    rawText = response.text.trim()
    finishReason = response.finishReason
  } catch (err) {
    if (err instanceof AiCredentialMissingError || err instanceof AiCredentialDecryptError) {
      return { generated: false, reason: 'no_credential' }
    }
    throw err
  }

  if (!rawText) {
    await writeCronFailureTrace(userId, { cronName: 'aether-regen', reason: 'empty_response', finishReason })
    return { generated: false, reason: 'empty_response' }
  }

  const validIds = aetherFedMemoryIds(ctx)
  let parsed: AetherPayload
  try {
    parsed = await parseWithRepair({
      provider,
      rawText,
      parse: (text) => groundAetherPayload(aetherGenSchema.parse(extractJsonBlock(text)), validIds),
      generatorLabel: 'aether',
      maxTokens: 10000,
      system: AETHER_SYSTEM_PROMPT,
      repairContext: [
        'Thought `id` and tension `aId`/`bId` are short labels unique within the response (t1, t2, …) — never UUIDs.',
        'Every sourceMemoryIds entry MUST be one of these memory ids, copied verbatim:',
        ...[...validIds].map((id) => `- ${id}`),
      ].join('\n'),
    })
  } catch (err) {
    if (err instanceof ParseRepairError) {
      await writeCronFailureTrace(userId, {
        cronName: 'aether-regen',
        reason: 'parse_failed',
        error: err.originalError ?? err,
        finishReason,
        rawExcerpt: err.rawExcerpt,
      })
      return { generated: false, reason: err.message }
    }
    throw err
  }

  if (parsed.thoughts.length === 0) {
    await writeCronFailureTrace(userId, { cronName: 'aether-regen', reason: 'all_thoughts_ungrounded' })
    return { generated: false, reason: 'all_thoughts_ungrounded' }
  }

  const runId = `aether:${userId}:${today}`
  const { aetherMemoryId } = await persistAether(userId, parsed, runId, today, 'cron', replayMetadata(replay))

  if (!aetherMemoryId) {
    await writeCronFailureTrace(userId, { cronName: 'aether-regen', reason: 'persist_failed' })
    return { generated: false, reason: 'persist_failed' }
  }

  await writeCronSuccessTrace(userId, { cronName: 'aether-regen' })
  return { generated: true, reason: 'ok' }
}
