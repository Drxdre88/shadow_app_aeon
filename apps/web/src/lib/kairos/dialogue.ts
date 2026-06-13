import { getPendingKairosAsk, markKairosAskAnswered, getPriorAethers } from '@/lib/data/ask'
import { captureReflection } from '@/lib/data/memories'
import {
  createDialogue,
  findOpenDialogueForAsk,
  loadDialogue,
  appendDialogueTurn as appendTurnRow,
  closeDialogue,
  fetchMemoriesByIds,
  fetchAetherPayload,
  writeFloatingReflection,
  type DialogueRole,
  type DialogueSeedMeta,
  type DialogueThread,
  type DialogueTurn,
  type SourceMemorySnapshot,
} from '@/lib/data/dialogue'
import { retrieveContext } from './retrieve'
import type { RetrievedMemory } from './recipes/_recipe'
import type { AetherThought } from './aether-types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Dialogue — orchestration (the "weld").
//
// Three islands existed separately: the Ask loop (initiative), the chat
// substrate (multi-turn memory), and the Claude-Code cognition pattern
// (prepare → synthesise in-context → commit, BYOK-free). This module fuses
// them: a pending ask opens a threaded dialogue; each Kairos turn is generated
// by Claude Code from a prepared, retrieval-grounded context; the finished
// thread is distilled back into durable reflections.
// ─────────────────────────────────────────────────────────────────────────

// ── open ───────────────────────────────────────────────────────────────────

export type OpenDialogueResult =
  | { ok: true; threadId: string; created: boolean; opening: string | null }
  | { ok: false; reason: 'ask_not_found' | 'no_seed' }

/**
 * Open (or resume) a dialogue. Seeded from a pending kairos-ask when
 * questionMemoryId is given — the ask's question becomes Kairos's opening turn
 * and the thread links back to the ask. Otherwise opens a free-standing topic.
 */
export async function openKairosDialogue(
  userId: string,
  opts: { questionMemoryId?: string; topic?: string; dominionId?: string | null },
): Promise<OpenDialogueResult> {
  if (opts.questionMemoryId) {
    const pending = await getPendingKairosAsk(userId)
    if (!pending || pending.id !== opts.questionMemoryId) {
      return { ok: false, reason: 'ask_not_found' }
    }

    // Idempotent: one open dialogue per ask.
    const existing = await findOpenDialogueForAsk(userId, pending.id)
    if (existing) return { ok: true, threadId: existing, created: false, opening: pending.title }

    const seed: DialogueSeedMeta = {
      kind: 'kairos-dialogue',
      kairosAskId: pending.id,
      aetherMemoryId: pending.kairosAsk.aetherMemoryId,
      sourceThoughtId: pending.kairosAsk.sourceThoughtId,
      sourceMemoryIds: pending.kairosAsk.sourceMemoryIds,
    }
    const threadId = await createDialogue(userId, {
      dominionId: pending.kairosAsk.dominionId,
      title: pending.title,
      seed,
    })
    // Seed Kairos's opening turn with the question itself.
    await appendTurnRow(userId, threadId, { role: 'kairos', content: pending.title })
    return { ok: true, threadId, created: true, opening: pending.title }
  }

  const topic = opts.topic?.trim()
  if (!topic) return { ok: false, reason: 'no_seed' }

  const [latestAether] = await getPriorAethers(userId, 1)
  const seed: DialogueSeedMeta = {
    kind: 'kairos-dialogue',
    kairosAskId: null,
    aetherMemoryId: latestAether?.id ?? null,
    sourceThoughtId: null,
    sourceMemoryIds: [],
  }
  const threadId = await createDialogue(userId, {
    dominionId: opts.dominionId ?? null,
    title: topic,
    seed,
  })
  return { ok: true, threadId, created: true, opening: null }
}

// ── prepare ──────────────────────────────────────────────────────────────

export interface DialogueContext {
  thread: { id: string; title: string; dominionId: string | null; status: string }
  seed: {
    kairosAskId: string | null
    aetherCoreNarrative: string | null
    thought: Pick<AetherThought, 'title' | 'insight' | 'kind' | 'salience'> | null
    sourceMemories: SourceMemorySnapshot[]
  }
  turns: Array<Pick<DialogueTurn, 'seq' | 'role' | 'content'>>
  retrieval: {
    cortex: RetrievedMemory | null
    archetypes: RetrievedMemory[]
    substrate: RetrievedMemory[]
  } | null
}

/**
 * Pack everything Claude Code needs to author Kairos's next turn: the seed
 * thought + its grounding memories + the Aether narrative, the full turn
 * history, and fresh retrieval keyed on the latest operator turn (only when the
 * dialogue is anchored to a Dominion — floating dialogues lean on the seed).
 */
export async function prepareDialogueContext(
  userId: string,
  threadId: string,
): Promise<DialogueContext | null> {
  const loaded = await loadDialogue(userId, threadId)
  if (!loaded) return null
  const { thread, turns } = loaded

  // Expand the seed: Aether narrative + the specific thought + grounding memories.
  let aetherCoreNarrative: string | null = null
  let thought: DialogueContext['seed']['thought'] = null
  if (thread.seed.aetherMemoryId) {
    const payload = await fetchAetherPayload(userId, thread.seed.aetherMemoryId)
    if (payload) {
      aetherCoreNarrative = payload.coreNarrative
      if (thread.seed.sourceThoughtId) {
        const t = payload.thoughts.find((x) => x.id === thread.seed.sourceThoughtId)
        if (t) thought = { title: t.title, insight: t.insight, kind: t.kind, salience: t.salience }
      }
    }
  }
  const sourceMemories = await fetchMemoriesByIds(userId, thread.seed.sourceMemoryIds)

  // Retrieval query = latest operator turn, falling back to the seed thought.
  const lastOperator = [...turns].reverse().find((t) => t.role === 'operator')
  const query = lastOperator?.content ?? thought?.insight ?? thought?.title ?? thread.title

  let retrieval: DialogueContext['retrieval'] = null
  if (thread.dominionId) {
    const r = await retrieveContext({ userId, dominionId: thread.dominionId, query })
    retrieval = { cortex: r.cortex, archetypes: r.archetypes, substrate: r.substrate }
  }

  return {
    thread: { id: thread.id, title: thread.title, dominionId: thread.dominionId, status: thread.status },
    seed: { kairosAskId: thread.seed.kairosAskId, aetherCoreNarrative, thought, sourceMemories },
    turns: turns.map((t) => ({ seq: t.seq, role: t.role, content: t.content })),
    retrieval,
  }
}

// ── append ─────────────────────────────────────────────────────────────────

export async function appendDialogueTurn(
  userId: string,
  threadId: string,
  role: DialogueRole,
  content: string,
  citations?: string[],
): Promise<{ ok: true; seq: number; turnId: string } | { ok: false; reason: 'thread_not_found' }> {
  const res = await appendTurnRow(userId, threadId, { role, content, citations })
  if (!res.ok) return res
  return { ok: true, seq: res.seq, turnId: res.turnId }
}

// ── commit ─────────────────────────────────────────────────────────────────

export interface DialogueDistillationReflection {
  dominionId?: string | null
  bodyMd: string
  title?: string | null
  summary?: string | null
  tags?: string[]
}

export type CommitDialogueResult =
  | { ok: true; reflectionIds: string[]; closedAsk: boolean }
  | { ok: false; reason: 'thread_not_found' | 'dominion_not_found' | 'no_reflections' }

/**
 * Distill a finished dialogue into durable reflections (anchored per-Dominion
 * or floating), link them to the seed ask, mark that ask answered, and close
 * the thread. Claude Code supplies the distillation — the server only persists.
 */
export async function commitDialogue(
  userId: string,
  threadId: string,
  input: { reflections: DialogueDistillationReflection[]; closeAsk?: boolean },
): Promise<CommitDialogueResult> {
  const loaded = await loadDialogue(userId, threadId)
  if (!loaded) return { ok: false, reason: 'thread_not_found' }
  if (input.reflections.length === 0) return { ok: false, reason: 'no_reflections' }

  const { thread } = loaded
  const provenance = { kairosDialogue: { threadId, kairosAskId: thread.seed.kairosAskId } }
  const reflectionIds: string[] = []

  for (const r of input.reflections) {
    const dominionId = r.dominionId ?? null
    const tags = ['kairos-dialogue', ...(r.tags ?? [])]
    if (dominionId) {
      const result = await captureReflection(userId, {
        dominionId,
        bodyMd: r.bodyMd,
        title: r.title ?? null,
        summary: r.summary ?? null,
        tags,
        source: 'claude',
        sourceMetadata: provenance,
      })
      if (!result.ok) return { ok: false, reason: 'dominion_not_found' }
      reflectionIds.push(result.memory.id)
    } else {
      const id = await writeFloatingReflection(userId, {
        bodyMd: r.bodyMd,
        title: r.title ?? null,
        summary: r.summary ?? null,
        tags,
        sourceMetadata: provenance,
      })
      reflectionIds.push(id)
    }
  }

  // Close the originating ask (if still pending) against the first reflection.
  let closedAsk = false
  const closeAsk = input.closeAsk ?? true
  if (closeAsk && thread.seed.kairosAskId) {
    const pending = await getPendingKairosAsk(userId)
    if (pending && pending.id === thread.seed.kairosAskId) {
      await markKairosAskAnswered(userId, pending.id, reflectionIds[0], new Date().toISOString())
      closedAsk = true
    }
  }

  await closeDialogue(userId, threadId)
  return { ok: true, reflectionIds, closedAsk }
}

export type { DialogueThread, DialogueTurn }
