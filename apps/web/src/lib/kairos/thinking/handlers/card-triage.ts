import { findLabels } from '@/lib/data/labels'
import { listJobs } from '@/lib/data/thinking-jobs'
import {
  findCardTriageBoard,
  findLabelIdsForTasks,
  listTriageBoards,
  listTriagePool,
  listUntriagedCards,
  writeCardTriages,
} from '@/lib/data/card-triage'
import {
  CARD_TRIAGE_MAX_OUTPUT_TOKENS,
  CARD_TRIAGE_SYSTEM_PROMPT,
  buildTriageJob,
  countSuggestions,
  groundTriage,
  parseTriageText,
  triageContextSchema,
} from '@/lib/kairos/triage/prompt'
import { CARD_TRIAGE_KIND, isCardTriageOn } from '@/lib/kairos/triage/types'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { errorReason } from './_errors'

// Card sorting (per-board settings.kairosTriage = 'on', deep tier, brain
// routine). plan: for each board the user created with the switch on, up to
// TRIAGE_BATCH new cards (last 48h, open, no triage yet, not already in an
// open/answered job) become one job; a title-similarity pre-filter picks the
// duplicate candidates the prompt may name. apply: map handles back to ids
// and write metadata.triage on each card — suggestions only, nothing applied.
// No fallback (no paid calls): an expired batch is offered again, at most
// TRIAGE_MAX_ATTEMPTS times per card.

export const TRIAGE_LOOKBACK_MS = 48 * 60 * 60 * 1000
export const TRIAGE_BATCH = 10
export const TRIAGE_MAX_BOARDS = 5
export const TRIAGE_MAX_ATTEMPTS = 3
export const CARD_TRIAGE_DEADLINE_MINUTES = 3 * 60
const DONE_POOL_MS = 30 * 24 * 60 * 60 * 1000
const JOB_SCAN_LIMIT = 200
const CARD_SCAN_LIMIT = 50
// A job in one of these states settles its cards: in flight, or answered, or rejected.
const SETTLING_STATUSES = new Set(['queued', 'claimed', 'done', 'failed'])

export function cardTriageKey(projectId: string, firstCardId: string, now: Date): string {
  return `${CARD_TRIAGE_KIND}:${projectId}:${firstCardId}:${now.toISOString().slice(0, 13)}`
}

// Cards no new job may include: in a settling job, or tried too often already.
export function blockedTriageCards(jobs: readonly ThinkingJobRow[]): Set<string> {
  const blocked = new Set<string>()
  const attempts = new Map<string, number>()
  for (const job of jobs) {
    const ctx = triageContextSchema.safeParse(job.input?.context)
    if (!ctx.success) continue
    for (const card of ctx.data.cards) {
      if (SETTLING_STATUSES.has(job.status)) blocked.add(card.id)
      const n = (attempts.get(card.id) ?? 0) + 1
      attempts.set(card.id, n)
      if (n >= TRIAGE_MAX_ATTEMPTS) blocked.add(card.id)
    }
  }
  return blocked
}

async function planBoard(board: { id: string; name: string }, blocked: Set<string>, now: Date): Promise<ThinkingJobSpec | null> {
  const since = new Date(now.getTime() - TRIAGE_LOOKBACK_MS)
  const fresh = (await listUntriagedCards(board.id, since, CARD_SCAN_LIMIT))
    .filter((c) => !blocked.has(c.id))
    .slice(0, TRIAGE_BATCH)
  if (fresh.length === 0) return null
  const [labels, pool, labelIds] = await Promise.all([
    findLabels(board.id),
    listTriagePool(board.id, new Date(now.getTime() - DONE_POOL_MS)),
    findLabelIdsForTasks(fresh.map((c) => c.id)),
  ])
  const { prompt, context } = buildTriageJob({
    projectId: board.id,
    boardName: board.name,
    labels: labels.map((l) => ({ id: l.id, name: l.name })),
    cards: fresh.map((c) => ({ ...c, labelIds: labelIds.get(c.id) ?? [] })),
    pool,
  })
  return {
    kind: CARD_TRIAGE_KIND,
    dominionId: null,
    externalKey: cardTriageKey(board.id, fresh[0].id, now),
    deadlineMinutes: CARD_TRIAGE_DEADLINE_MINUTES,
    input: {
      system: CARD_TRIAGE_SYSTEM_PROMPT,
      prompt,
      validMemoryIds: [],
      maxOutputTokens: CARD_TRIAGE_MAX_OUTPUT_TOKENS,
      context,
    },
  }
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const boards = await listTriageBoards(userId)
  if (boards.length === 0) return []
  const since = new Date(now.getTime() - TRIAGE_LOOKBACK_MS - CARD_TRIAGE_DEADLINE_MINUTES * 60_000)
  const jobs = await listJobs(userId, { kind: CARD_TRIAGE_KIND, since, limit: JOB_SCAN_LIMIT })
  const blocked = blockedTriageCards(jobs)
  const specs: ThinkingJobSpec[] = []
  for (const board of boards) {
    if (specs.length >= TRIAGE_MAX_BOARDS) break
    const spec = await planBoard(board, blocked, now)
    if (spec) specs.push(spec)
  }
  return specs
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const parsedCtx = triageContextSchema.safeParse(job.input?.context)
  if (!parsedCtx.success) return { ok: false, reason: `bad_job: ${errorReason(parsedCtx.error)}` }
  const ctx = parsedCtx.data

  // The owner may have switched sorting off (or the board changed hands)
  // since planning: then nothing is written.
  const board = await findCardTriageBoard(ctx.projectId)
  if (!board || board.userId !== job.userId || !isCardTriageOn(board.settings)) {
    return { ok: true, memoryIds: [], output: { skipped: 'switched_off', answeredBy } }
  }

  let answer
  try {
    answer = parseTriageText(text)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  const triages = groundTriage(answer, ctx, job.id, new Date().toISOString())
  const entries = [...triages].map(([taskId, triage]) => ({ taskId, triage }))
  const cards = await writeCardTriages(ctx.projectId, job.id, entries)
  const suggestions = entries.reduce((n, e) => n + countSuggestions(e.triage), 0)
  return { ok: true, memoryIds: [], output: { cards, suggestions, answeredBy } }
}

export const cardTriageHandler: ThinkingJobHandler = {
  kind: CARD_TRIAGE_KIND,
  plan,
  apply,
  fallback: async () => ({ ok: false, reason: 'no fallback — card sorting runs only on the Max plan' }),
}
