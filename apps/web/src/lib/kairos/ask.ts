import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { getLatestAether } from '@/lib/data/aether'
import {
  getPriorAethers,
  getReflectionsSince,
  getPendingKairosAsk,
  getOpenKairosAskById,
  listOpenKairosAsks,
  markKairosAskDismissed,
  getNewestKairosAsk,
  createKairosAskMemory,
  markKairosAskAnswered,
  archiveOrphanAnswerMemory,
  type KairosAskRow,
  type KairosCardNotesMeta,
} from '@/lib/data/ask'
import { captureReflection, markKairosSpeaksReplied } from '@/lib/data/memories'
import { reactOutcome, reactUsed } from '@/lib/kairos/reactions'
import { appendTaskDescription, findTaskById } from '@/lib/data/tasks'
import { updateVaultDescription } from '@/lib/data/vault'
import { verifyProjectAccess } from '@/lib/data/projects'
import { selectKairosQuestion } from './ask-select'
import { hasNumberedMatches, mightAnswerKairosAsks, parseNumberedAnswers, parseReplyToAsk } from './ask-numbered'
import type { Origin } from './origin'
import { recordToday, type TodayChannel } from './today'

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

// P2.5 origin of an ask answer. Owner surfaces (inbox action, app/Telegram
// chat) pass { kind: 'operator', via: 'ask' }; any other caller (the MCP
// kairos_ask tool) is an agent relaying the answer.
const ASK_DEFAULT_ORIGIN: Origin = { kind: 'agent', via: 'ask' }

async function writeUntetheredAnswer(
  userId: string,
  answerText: string,
  questionMemoryId: string,
  extraMetadata: Record<string, unknown> = {},
  origin: Origin = ASK_DEFAULT_ORIGIN,
): Promise<string> {
  const title = answerText.split('\n')[0]?.slice(0, 80).trim() || 'Vorath Ask response'
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
      sourceMetadata: { kairosReflect: true, kairosAskResponseTo: questionMemoryId, ...extraMetadata, origin },
      tags: ['kairos-ask-answer'],
      pinned: false,
    })
    .returning({ id: memories.id })
  return row!.id
}

// ─── card_notes answers → notes written back onto the cards ──────────────

type NoteCard = KairosCardNotesMeta['cards'][number]
export type CardNote = { card: NoteCard; line: string }

const NUMBERED_LINE = /^\s*\(?(\d{1,2})\s*[.):\-–—]\s*(.*)$/
const BULLET_LINE = /^\s*[-*•]\s+(.+)$/
const DESCRIPTION_MAX = 10_000
const NOTE_LINE_MAX = 500

function clipNote(line: string): string {
  const flat = line.replace(/\s+/g, ' ').trim()
  return flat.length <= NOTE_LINE_MAX ? flat : `${flat.slice(0, NOTE_LINE_MAX - 1).trimEnd()}…`
}

/**
 * Map an operator's reply onto the asked cards. One card → the whole answer.
 * Several → numbered lines ("1.", "1)", "1 -") by number, or plain bullets in
 * order when their count matches. Anything else → [] (memory only).
 */
export function parseCardNotesAnswer(answerText: string, cards: NoteCard[]): CardNote[] {
  const answer = answerText.trim()
  if (!answer || cards.length === 0) return []
  if (cards.length === 1) return [{ card: cards[0]!, line: clipNote(answer) }]

  const byNumber = new Map<number, string[]>()
  let current: number | null = null
  for (const rawLine of answer.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const numbered = NUMBERED_LINE.exec(line)
    const index = numbered ? Number(numbered[1]) : NaN
    if (numbered && index >= 1 && index <= cards.length) {
      current = index
      byNumber.set(index, [...(byNumber.get(index) ?? []), numbered[2]!.trim()].filter(Boolean))
    } else if (current !== null) {
      byNumber.get(current)!.push(line)
    }
  }
  if (byNumber.size > 0) {
    return [...byNumber.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap(([index, parts]) => {
        const line = clipNote(parts.join(' '))
        return line ? [{ card: cards[index - 1]!, line }] : []
      })
  }

  const bullets = answer.split('\n').flatMap((line) => {
    const match = BULLET_LINE.exec(line.trim())
    return match ? [match[1]!.trim()] : []
  })
  if (bullets.length === cards.length) {
    return bullets.map((line, index) => ({ card: cards[index]!, line: clipNote(line) }))
  }
  return []
}

function ddmm(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function appendCardNote(existing: string | null, line: string, at: Date): string {
  const note = `Notes (via Vorath, ${ddmm(at)}): ${line}`
  const base = (existing ?? '').trimEnd()
  return base ? `${base}\n\n${note}` : note
}

/**
 * Best-effort write-back: each note lands on its card's description via the
 * data layer — live cards through appendTaskDescription (atomic append, bumps boardVersion +
 * publishes), vaulted cards through updateVaultDescription. Both need edit
 * access to the card's project. Never throws.
 */
export async function writeBackCardNotes(
  userId: string,
  notes: CardNote[],
  at: Date = new Date(),
): Promise<Array<{ taskId?: string; vaultId?: string; status: 'written' | 'memory_only' | 'skipped'; reason?: string }>> {
  const outcomes: Array<{ taskId?: string; vaultId?: string; status: 'written' | 'memory_only' | 'skipped'; reason?: string }> = []
  for (const { card, line } of notes) {
    const ref = card.taskId ? { taskId: card.taskId } : { vaultId: card.vaultId }
    if (!card.projectId || (!card.taskId && !card.vaultId)) {
      outcomes.push({ ...ref, status: 'memory_only', reason: 'no_project' })
      continue
    }
    try {
      const access = await verifyProjectAccess(card.projectId, userId)
      if (!access || access.role === 'viewer') {
        outcomes.push({ ...ref, status: 'skipped', reason: 'no_edit_access' })
        continue
      }
      if (!card.taskId) {
        const result = await updateVaultDescription(card.vaultId!, card.projectId, (existing) => {
          const description = appendCardNote(existing, line, at)
          return description.length > DESCRIPTION_MAX ? null : description
        })
        if (result === 'written') outcomes.push({ ...ref, status: 'written' })
        else if (result === 'not_found') outcomes.push({ ...ref, status: 'memory_only', reason: 'card_gone' })
        else outcomes.push({ ...ref, status: 'skipped', reason: 'description_too_long' })
        continue
      }
      const task = await findTaskById(card.taskId, card.projectId)
      if (!task) {
        outcomes.push({ ...ref, status: 'memory_only', reason: 'card_gone' })
        continue
      }
      const note = appendCardNote(null, line, at)
      const written = await appendTaskDescription(card.taskId, card.projectId, note, DESCRIPTION_MAX)
      if (!written) {
        outcomes.push({ ...ref, status: 'skipped', reason: 'description_too_long' })
        continue
      }
      outcomes.push({ ...ref, status: 'written' })
    } catch (err) {
      console.error('[kairos-ask] card note write-back failed', { ...ref, err })
      outcomes.push({ ...ref, status: 'skipped', reason: 'error' })
    }
  }
  return outcomes
}

export async function answerKairosAsk(
  userId: string,
  questionMemoryId: string,
  answerText: string,
  dominionIdOverride?: string,
  origin: Origin = ASK_DEFAULT_ORIGIN,
): Promise<AnswerKairosAskResult> {
  // Any open ask can be answered by id — not just the newest — so a backlog
  // of numbered questions can be caught up in any order.
  const pending = await getOpenKairosAskById(userId, questionMemoryId)
  if (!pending) {
    return { error: 'not_found' }
  }

  const dominionId = dominionIdOverride ?? pending.kairosAsk.dominionId

  const cardNotesMeta = pending.cardNotes
  const cardNotes = cardNotesMeta ? parseCardNotesAnswer(answerText, cardNotesMeta.cards) : []
  const extraMetadata: Record<string, unknown> = cardNotesMeta
    ? {
        kind: 'card_notes_answer',
        taskIds: cardNotesMeta.cards.flatMap((card) => (card.taskId ? [card.taskId] : [])),
        vaultIds: cardNotesMeta.cards.flatMap((card) => (card.vaultId ? [card.vaultId] : [])),
        cardNotes: cardNotes.map(({ card, line }) => ({
          ...(card.taskId ? { taskId: card.taskId } : {}),
          ...(card.vaultId ? { vaultId: card.vaultId } : {}),
          title: card.title,
          line,
        })),
      }
    : {}

  let answerMemoryId: string

  if (!dominionId) {
    answerMemoryId = await writeUntetheredAnswer(userId, answerText, questionMemoryId, extraMetadata, origin)
  } else {
    const result = await captureReflection(userId, {
      dominionId,
      bodyMd: answerText,
      title: null,
      summary: null,
      tags: ['kairos-ask-answer'],
      source: 'manual',
      sourceMetadata: { kairosReflect: true, kairosAskResponseTo: questionMemoryId, ...extraMetadata },
    }, { origin })

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
  await recordAskAnswerToday(userId, pending, answerText, answerMemoryId, origin)
  // An answer from any surface (web inbox, MCP, chat) is an operator reply:
  // close pending speaks so the reply gate doesn't wait out 48h. Best-effort —
  // the answer is already persisted and must not fail on the marker.
  try {
    await markKairosSpeaksReplied(userId, new Date())
  } catch (err) {
    console.error('[kairos-ask] failed to mark speaks replied', err)
  }
  // Thin-card nudge: file each line onto its card. Best-effort — the answer
  // memory above already holds every line, so write-back never fails it.
  if (cardNotes.length > 0) {
    try {
      await writeBackCardNotes(userId, cardNotes, new Date())
    } catch (err) {
      console.error('[kairos-ask] card notes write-back failed', err)
    }
  }
  // Memory engine reactions (docs/kairos/32 §2, 34 §6): the ask itself got an
  // answer → Outcome positive; the memories it was built from were used →
  // Usage. Both best-effort (never throw); non-uuid source ids are skipped.
  await reactOutcome(userId, questionMemoryId, 'positive', 'kairos ask answered')
  const sourceIds = pending.kairosAsk.sourceMemoryIds ?? []
  if (sourceIds.length > 0) await reactUsed(userId, sourceIds, 'kairos ask answered')
  return { reflectionId: answerMemoryId }
}

// One "answered" entry per claimed answer, stamped with the caller's origin
// (never re-derived from the text). Only reached after the claim wins, so a
// lost race records nothing. recordToday never throws.
function todayChannelForAsk(origin: Origin): TodayChannel {
  if (origin.via === 'telegram') return 'telegram'
  if (origin.via === 'mcp') return 'mcp'
  return 'ask'
}

async function recordAskAnswerToday(
  userId: string,
  pending: KairosAskRow,
  answerText: string,
  answerMemoryId: string,
  origin: Origin,
): Promise<void> {
  const seq = pending.kairosAsk.seq
  const label = typeof seq === 'number' ? `Q${seq}` : 'Q'
  await recordToday(
    userId,
    {
      key: `ask:${pending.id}`,
      channel: todayChannelForAsk(origin),
      type: 'answered',
      text: `${label} (${pending.title}): ${answerText}`,
      ref: { askId: pending.id, memoryId: answerMemoryId },
      covered: 'ask-reflection',
    },
    origin,
  )
}

// ─── Backlog: dismiss + numbered answers (Q<seq>) ─────────────────────────

export type DismissKairosAskResult = { ok: true; id: string } | { error: 'not_found' }

/**
 * Operator "skip": status 'dismissed' + archived, no Outcome reaction (a
 * dismissal is not a miss, unlike expiry). not_found when the ask is not
 * open (answered, expired, dismissed, or someone else's).
 */
export async function dismissKairosAsk(userId: string, askId: string, now: Date = new Date()): Promise<DismissKairosAskResult> {
  const dismissed = await markKairosAskDismissed(userId, askId, now)
  return dismissed ? { ok: true, id: askId } : { error: 'not_found' }
}

export type NumberedAnswerOutcome =
  | { matched: false }
  | { matched: true; answered: number[]; skipped: number[]; failed: number[]; stillOpen: number[] }

/**
 * Deterministic pre-router for operator text: "Q12: …" / "Q12 …" answers,
 * "skip Q12" dismissals, or a reply quoting one open Q. matched:false (no
 * open question named) means the text is ordinary chat. Owner surfaces
 * (Telegram) keep the operator origin; an agent relaying the owner's message
 * (Triad via MCP/REST) passes an agent origin.
 */
export async function answerNumberedKairosAsks(
  userId: string,
  body: string,
  now: Date = new Date(),
  replyText?: string,
  origin: Origin = { kind: 'operator', via: 'ask' },
): Promise<NumberedAnswerOutcome> {
  if (!mightAnswerKairosAsks(body, replyText)) return { matched: false }
  const open = await listOpenKairosAsks(userId, now)
  const seqs = open.map((ask) => ask.seq)
  const numbered = parseNumberedAnswers(body, seqs)
  const parsed = hasNumberedMatches(numbered) ? numbered : parseReplyToAsk(body, replyText, seqs)
  if (!hasNumberedMatches(parsed)) return { matched: false }

  const bySeq = new Map(open.map((ask) => [ask.seq, ask]))
  const answered: number[] = []
  const skipped: number[] = []
  const failed: number[] = []
  for (const { seq, text } of parsed.answers) {
    try {
      const result = await answerKairosAsk(userId, bySeq.get(seq)!.id, text, undefined, origin)
      ;('error' in result ? failed : answered).push(seq)
    } catch (err) {
      console.error('[kairos-ask] numbered answer failed', { seq, err })
      failed.push(seq)
    }
  }
  for (const seq of parsed.skips) {
    try {
      const result = await dismissKairosAsk(userId, bySeq.get(seq)!.id, now)
      ;('error' in result ? failed : skipped).push(seq)
    } catch (err) {
      console.error('[kairos-ask] numbered skip failed', { seq, err })
      failed.push(seq)
    }
  }
  const closed = new Set([...answered, ...skipped])
  const stillOpen = open.map((ask) => ask.seq).filter((seq) => !closed.has(seq))
  return { matched: true, answered, skipped, failed, stillOpen }
}