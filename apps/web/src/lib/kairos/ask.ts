import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { getLatestAether } from '@/lib/data/aether'
import {
  getPriorAethers,
  getReflectionsSince,
  getPendingKairosAsk,
  getNewestKairosAsk,
  createKairosAskMemory,
  markKairosAskAnswered,
  archiveOrphanAnswerMemory,
  type KairosAskRow,
} from '@/lib/data/ask'
import { captureReflection } from '@/lib/data/memories'
import { selectKairosQuestion } from './ask-select'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Asks — proactive-question layer above Aether.
//
// Aether produces candidate questions and tensions; this layer selects the
// single one worth interrupting the operator with (see ./ask-select for the
// pure selection logic), persists it as a pending kairos-ask advisory memory,
// and records the operator's answer back as a reflection. v1 is fully
// deterministic — no LLM calls.
// ─────────────────────────────────────────────────────────────────────────

export { selectKairosQuestion } from './ask-select'
export type { SelectInput, SelectResult } from './ask-select'

// ─────────────────────────────────────────────────────────────────────────
// DB-backed orchestrators
// ─────────────────────────────────────────────────────────────────────────

export type RunKairosAskResult =
  | { asked: true; question: KairosAskRow }
  | { asked: false; reason: 'pending'; pending: KairosAskRow }
  | { asked: false; reason: 'silent' }
  | { asked: false; reason: 'no_aether' }

export async function runKairosAsk(userId: string, now: Date = new Date()): Promise<RunKairosAskResult> {
  const pending = await getPendingKairosAsk(userId)
  if (pending) {
    return { asked: false, reason: 'pending', pending }
  }

  const latest = await getLatestAether(userId)
  if (!latest) {
    return { asked: false, reason: 'no_aether' }
  }

  const priorAethers = await getPriorAethers(userId, 5)
  const latestAetherRow = priorAethers[0] ?? null
  const aetherMemoryId = latestAetherRow?.id ?? ''

  const priorThoughtSourceIds: string[][] = priorAethers
    .slice(1)
    .flatMap((a) => {
      if (!a.payload) return []
      return a.payload.thoughts
        .filter((t) => t.kind === 'question' || t.kind === 'tension')
        .map((t) => t.sourceMemoryIds)
    })

  const latestAetherCreatedAt = latestAetherRow?.createdAt ?? new Date(0)
  const recentReflections = await getReflectionsSince(userId, latestAetherCreatedAt)

  // addressedSourceIds: populated from reflection sourceMetadata.sourceMemoryIds
  // if present. Reflections do not carry this field in the current schema, so
  // this set stays empty for v1. A future extension can populate it without
  // changing callers.
  const addressedSourceIds = new Set<string>()
  for (const r of recentReflections) {
    const ids = r.sourceMetadata?.sourceMemoryIds
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === 'string') addressedSourceIds.add(id)
      }
    }
  }

  const newestAsk = await getNewestKairosAsk(userId)
  const lastAskedAt = newestAsk?.createdAt ?? null

  const selected = selectKairosQuestion({
    latest,
    priorThoughtSourceIds,
    addressedSourceIds,
    lastAskedAt,
    now,
  })

  if (!selected) {
    return { asked: false, reason: 'silent' }
  }

  const askedAt = now.toISOString()
  const questionId = await createKairosAskMemory(userId, {
    question: selected.question,
    dominionId: selected.dominionId,
    aetherMemoryId,
    sourceThoughtId: selected.sourceThoughtId,
    sourceMemoryIds: selected.sourceMemoryIds,
    askedAt,
  })

  const question: KairosAskRow = {
    id: questionId,
    title: selected.question,
    summary: selected.question,
    dominionId: selected.dominionId,
    createdAt: now,
    kairosAsk: {
      status: 'pending',
      aetherMemoryId,
      sourceThoughtId: selected.sourceThoughtId,
      sourceMemoryIds: selected.sourceMemoryIds,
      dominionId: selected.dominionId,
      askedAt,
    },
  }

  return { asked: true, question }
}

export type AnswerKairosAskResult =
  | { reflectionId: string }
  | { error: 'not_found' }
  | { error: 'dominion_not_found' }

async function writeUntetheredAnswer(
  userId: string,
  answerText: string,
  questionMemoryId: string,
): Promise<string> {
  const title = answerText.split('\n')[0]?.slice(0, 80).trim() || 'Kairos Ask response'
  const [row] = await db
    .insert(memories)
    .values({
      userId,
      dominionId: null,
      title,
      bodyMd: answerText,
      summary: null,
      type: 'reflection',
      streamClass: 'reflection',
      source: 'manual',
      sourceMetadata: { kairosReflect: true, kairosAskResponseTo: questionMemoryId },
      tags: ['kairos-ask-answer'],
      pinned: false,
    })
    .returning({ id: memories.id })
  return row!.id
}

export async function answerKairosAsk(
  userId: string,
  questionMemoryId: string,
  answerText: string,
  dominionIdOverride?: string,
): Promise<AnswerKairosAskResult> {
  const pending = await getPendingKairosAsk(userId)
  if (!pending || pending.id !== questionMemoryId) {
    return { error: 'not_found' }
  }

  const dominionId = dominionIdOverride ?? pending.kairosAsk.dominionId

  let answerMemoryId: string

  if (!dominionId) {
    answerMemoryId = await writeUntetheredAnswer(userId, answerText, questionMemoryId)
  } else {
    const result = await captureReflection(userId, {
      dominionId,
      bodyMd: answerText,
      title: null,
      summary: null,
      tags: ['kairos-ask-answer'],
      source: 'manual',
      sourceMetadata: { kairosReflect: true, kairosAskResponseTo: questionMemoryId },
    })

    if (!result.ok) {
      return { error: 'dominion_not_found' }
    }
    answerMemoryId = result.memory.id
  }

  const claimed = await markKairosAskAnswered(userId, questionMemoryId, answerMemoryId, new Date().toISOString())
  if (!claimed) {
    // A concurrent turn answered first — drop our duplicate answer memory.
    await archiveOrphanAnswerMemory(userId, answerMemoryId)
    return { error: 'not_found' }
  }
  return { reflectionId: answerMemoryId }
}
