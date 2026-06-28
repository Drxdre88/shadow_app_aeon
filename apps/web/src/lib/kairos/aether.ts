import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, dominions } from '@/lib/db/schema'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import {
  buildAetherPrompt,
  aetherOutSchema,
  extractJsonBlock,
  renderAetherMarkdown,
  type AetherContext,
  type CortexSnapshotRow,
  type GlobalReflectionRow,
  type GlobalArchetypeRow,
  type PriorAetherRow,
} from './aether-prompt'
import { todayIso } from './_prompt-utils'
import type { AetherPayload } from './aether-types'

// Kairos Aether (B3) — global self-model synthesiser.
// Idempotent: skips if a live aether row already exists for today (UTC).
// Anti-drift: thoughts without sourceMemoryIds are stripped before persist.

const MAX_REFLECTIONS = 40
const MAX_ARCHETYPES_PER_DOMINION = 3

async function alreadyRanToday(userId: string): Promise<boolean> {
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

export async function fetchAetherInputs(userId: string): Promise<{
  cortexSnapshots: CortexSnapshotRow[]
  topReflections: GlobalReflectionRow[]
  archetypes: GlobalArchetypeRow[]
  prior: PriorAetherRow | null
}> {
  const activeDoms = await db
    .select({ id: dominions.id, name: dominions.name, color: dominions.color })
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
    if (!dom) continue
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

  return { cortexSnapshots, topReflections, archetypes, prior }
}

export async function persistAether(
  userId: string,
  payload: AetherPayload,
  runId: string,
  today: string,
  source: 'cron' | 'claude' = 'cron',
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
  const ctx: AetherContext = { userId, today, ...inputs }
  const prompt = buildAetherPrompt(ctx)

  let rawText: string
  try {
    const { provider } = await getProviderForTask(userId, { taskType: 'aether' })
    const response = await provider.ask({
      prompt,
      maxTokens: 4000,
    })
    rawText = response.text.trim()
  } catch (err) {
    if (err instanceof AiCredentialMissingError || err instanceof AiCredentialDecryptError) {
      return { generated: false, reason: 'no_credential' }
    }
    throw err
  }

  if (!rawText) {
    return { generated: false, reason: 'empty_response' }
  }

  let parsed: AetherPayload
  try {
    const raw = aetherOutSchema.parse(extractJsonBlock(rawText))
    // Anti-drift leash: strip any thought the schema let through with zero
    // sourceMemoryIds (schema requires min 1, but be defensive).
    parsed = {
      ...raw,
      thoughts: raw.thoughts.filter((t) => t.sourceMemoryIds.length > 0),
    } as AetherPayload
  } catch {
    return { generated: false, reason: 'parse_failed' }
  }

  if (parsed.thoughts.length === 0) {
    return { generated: false, reason: 'all_thoughts_ungrounded' }
  }

  const runId = `aether:${userId}:${today}`
  const { aetherMemoryId } = await persistAether(userId, parsed, runId, today)

  return aetherMemoryId
    ? { generated: true, reason: 'ok' }
    : { generated: false, reason: 'persist_failed' }
}
