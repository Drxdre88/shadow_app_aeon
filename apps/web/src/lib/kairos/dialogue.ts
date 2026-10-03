import { getOpenKairosAskById, markKairosAskAnswered, getPriorAethers } from '@/lib/data/ask'
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
  filterLiveDominionIds,
  type DialogueRole,
  type DialogueSeedMeta,
  type DialogueThread,
  type DialogueTurn,
  type SourceMemorySnapshot,
} from '@/lib/data/dialogue'
import { retrieveContext } from './retrieve'
import { dominionTag } from './dominionTags'
import type { RetrievedMemory } from './recipes/_recipe'
import type { AetherThought } from './aether-types'
import type { Origin } from './origin'
import { loadTodayDigest, recordTodayAfter } from './today'
import { renderTodaySection } from './today-render'
import { loadStageBlock } from './stage'

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
    // Any open ask in the backlog can seed a dialogue, not just the newest.
    const pending = await getOpenKairosAskById(userId, opts.questionMemoryId)
    if (!pending) {
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
  // "Today across channels" (one mind), rendered inside DATA markers; this
  // dialogue's own turns are excluded. '' when off or quiet.
  today: string
  // The stage block (what Kairos is attending to now), fenced as STAGE DATA
  // and "not evidence". '' unless KAIROS_STAGE=1 and the stage has a winner.
  stage: string
}

// Same budget as the chat prompt's today section.
const DIALOGUE_TODAY_MAX_CHARS = 1800

async function loadDialogueToday(userId: string, threadId: string): Promise<string> {
  try {
    const digest = await loadTodayDigest(userId, { excludeThreadId: threadId })
    return renderTodaySection(digest, { maxChars: DIALOGUE_TODAY_MAX_CHARS })
  } catch {
    return ''
  }
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
  const todayPromise = loadDialogueToday(userId, threadId)
  const stagePromise = loadStageBlock(userId)
  if (thread.dominionId) {
    const r = await retrieveContext({ userId, dominionId: thread.dominionId, query })
    retrieval = { cortex: r.cortex, archetypes: r.archetypes, substrate: r.substrate }
  }

  return {
    thread: { id: thread.id, title: thread.title, dominionId: thread.dominionId, status: thread.status },
    seed: { kairosAskId: thread.seed.kairosAskId, aetherCoreNarrative, thought, sourceMemories },
    turns: turns.map((t) => ({ seq: t.seq, role: t.role, content: t.content })),
    retrieval,
    today: await todayPromise,
    stage: (await stagePromise).block,
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
  // One mind: an agent (Triad / Claude Code) wrote this turn, so it is never
  // the owner's own words — an operator turn is a relayed statement.
  recordTodayAfter(
    userId,
    {
      key: `dialogue:${threadId}:${res.seq}`,
      channel: 'triad',
      type: role === 'operator' ? 'said' : 'replied',
      text: content,
      ref: { dialogueId: threadId, seq: res.seq },
      covered: 'dialogue-commit',
      ...(role === 'operator' ? { relayedRole: 'operator' as const } : {}),
    },
    { kind: 'agent', via: 'dialogue' },
  )
  return { ok: true, seq: res.seq, turnId: res.turnId }
}

// ── commit ─────────────────────────────────────────────────────────────────

export interface DialogueDistillationReflection {
  /** Optional "home" Dominion — anchors the reflection's dominionId FK. Often
   *  null for cross-front reflections, which lean on dominionIds tags instead. */
  dominionId?: string | null
  /** Dominions this reflection *touches* — written as soft `dominion:<id>`
   *  reference tags so it surfaces from each without being owned by one. */
  dominionIds?: string[]
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
  // P2.5: the distillation is written by the AI client (Claude Code), so these
  // are agent-origin reflections, never the operator's own words.
  const origin: Origin = { kind: 'agent', via: 'dialogue' }
  const reflectionIds: string[] = []

  for (const r of input.reflections) {
    const dominionId = r.dominionId ?? null
    // Auto-tag the Dominions this reflection touches (validated, deduped against
    // the home FK which already covers it). Fluid grouping over hard pinning.
    const requestedRefs = (r.dominionIds ?? []).filter((id) => id && id !== dominionId)
    const liveRefs = requestedRefs.length ? await filterLiveDominionIds(userId, requestedRefs) : []
    const tags = ['kairos-dialogue', ...liveRefs.map(dominionTag), ...(r.tags ?? [])]
    if (dominionId) {
      const result = await captureReflection(userId, {
        dominionId,
        bodyMd: r.bodyMd,
        title: r.title ?? null,
        summary: r.summary ?? null,
        tags,
        source: 'claude',
        sourceMetadata: provenance,
      }, { origin })
      if (!result.ok) return { ok: false, reason: 'dominion_not_found' }
      reflectionIds.push(result.memory.id)
    } else {
      const id = await writeFloatingReflection(userId, {
        bodyMd: r.bodyMd,
        title: r.title ?? null,
        summary: r.summary ?? null,
        tags,
        sourceMetadata: { ...provenance, origin },
      })
      reflectionIds.push(id)
    }
  }

  // Close the originating ask (if still pending) against the first reflection.
  let closedAsk = false
  const closeAsk = input.closeAsk ?? true
  if (closeAsk && thread.seed.kairosAskId) {
    const pending = await getOpenKairosAskById(userId, thread.seed.kairosAskId)
    if (pending) {
      await markKairosAskAnswered(userId, pending.id, reflectionIds[0], new Date().toISOString())
      closedAsk = true
    }
  }

  await closeDialogue(userId, threadId)
  return { ok: true, reflectionIds, closedAsk }
}

export type { DialogueThread, DialogueTurn }
