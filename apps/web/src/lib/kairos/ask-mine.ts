import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialDecryptError, AiCredentialMissingError } from '@/lib/ai/router'
import {
  createKairosAskMemory,
  listOpenKairosAsks,
  listExpiredPendingKairosAskIds,
  listKairosReflectionStaleness,
  listRecentKairosAsks,
  markKairosAskExpired,
  type KairosAskRow,
} from '@/lib/data/ask'
import { reactOutcome } from '@/lib/kairos/reactions'
import { listBoardDayPages } from '@/lib/data/board-feed'
import { buildCardNotesQuestion, thinCardsFromPage, type ThinCard } from './board-feed-render'
import {
  listRecentlyCompletedTasks,
  listRecentlyCreatedTasks,
  listStaleTasks,
} from '@/lib/data/board-signals'
import { findDominionsByUser } from '@/lib/data/dominions'
import { isJobDone } from '@/lib/data/thinking-jobs'
import { getConversationState } from './engagement'
import { fetchAetherInputs } from './aether'
import {
  ASK_MINE_SYSTEM_PROMPT,
  buildAskMineUserPrompt,
  parseAskMineResponse,
  type AskMineCandidate,
  type AskMineSignalBundle,
} from './ask-mine-prompt'
import { loadOwnerTodayForAskMine, type OwnerTodaySignal } from './ask-mine-today'

const DAY_MS = 86_400_000
// An ask stays open (answerable by its Q number) for 14 days; past that the
// sweep expires it with a negative outcome.
const ASK_EXPIRY_MS = 14 * DAY_MS
// At most this many open asks; ask-mine stops adding while the backlog is full.
export const ASK_BACKLOG_MAX = 10
// Duplicate-guard lookback: covers every ask that can still be open.
const ASK_DEDUP_LOOKBACK_DAYS = 15
const MAX_OUTPUT_TOKENS = 4000
const FUZZY_MATCH_THRESHOLD = 0.6

const TITLE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'do', 'does', 'for', 'have', 'has', 'how', 'i', 'in', 'is', 'it',
  'of', 'on', 'or', 'our', 'should', 'still', 'the', 'this', 'to', 'we', 'what', 'when', 'which',
  'why', 'with', 'would', 'you', 'your',
])

// Thinking-queue key of a user's ask_mine job for one UTC date.
export const askMineJobKey = (date: string) => `ask_mine:${date}`

export type AskMineGateReason = 'backlog_full' | 'awaiting_reply' | 'already_ran'

export interface AskMineOptions {
  date?: string
  dryRun?: boolean
  now?: Date
}

export type AskMineRunResult =
  | { status: 'created'; date: string; askId: string; candidate: AskMineCandidate; expiresAt: string }
  | { status: 'created'; date: string; askId: string; kind: 'card_notes'; cardCount: number; expiresAt: string }
  | { status: 'dry_run'; date: string; modelInput: ModelInput; signalCount: number }
  | {
      status: 'skipped'
      date: string
      reason: AskMineGateReason | 'no_signals' | 'no_candidate' | 'no_credential' | 'key_undecryptable'
    }

export interface ModelInput {
  system: string
  prompt: string
  cacheSystem: boolean
  maxOutputTokens: number
}

function resolveDate(date: string | undefined, now: Date): string {
  const target = date ?? now.toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error('date must be YYYY-MM-DD')
  const parsed = new Date(`${target}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== target) {
    throw new Error('date must be a valid UTC calendar date')
  }
  return target
}

function previousDate(date: string, days: number): string {
  const timestamp = new Date(`${date}T00:00:00.000Z`).getTime() - days * DAY_MS
  return new Date(timestamp).toISOString().slice(0, 10)
}

function titleTokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1 && !TITLE_STOP_WORDS.has(token)),
  )
}

export function fuzzyAskTitleMatch(left: string, right: string): boolean {
  const leftTokens = titleTokens(left)
  const rightTokens = titleTokens(right)
  if (leftTokens.size === 0 || rightTokens.size === 0) return left.trim().toLowerCase() === right.trim().toLowerCase()
  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1
  }
  return (2 * overlap) / (leftTokens.size + rightTokens.size) >= FUZZY_MATCH_THRESHOLD
}

function sourceOverlap(candidate: AskMineCandidate, ask: KairosAskRow): boolean {
  const priorIds = new Set(ask.askMine?.sourceMemoryIds ?? ask.kairosAsk.sourceMemoryIds)
  return candidate.sourceMemoryIds.some((id) => priorIds.has(id))
}

export function selectAskMineCandidate(
  candidates: AskMineCandidate[],
  recentAsks: KairosAskRow[],
  date: string,
): AskMineCandidate | null {
  const yesterday = previousDate(date, 1)
  const weekAgo = previousDate(date, 6)
  const yesterdayAsk = recentAsks.find((ask) => ask.askMine?.date === yesterday)
  const valuesAskedThisWeek = recentAsks.some((ask) => (
    ask.askMine?.kind === 'values'
    && ask.askMine.date >= weekAgo
    && ask.askMine.date <= date
  ))

  const eligible = candidates.filter((candidate) => {
    if (candidate.kind === yesterdayAsk?.askMine?.kind) return false
    if (
      candidate.dominionId
      && candidate.dominionId === yesterdayAsk?.dominionId
      && candidate.leverage < 0.9
    ) return false
    if (candidate.kind === 'values' && valuesAskedThisWeek) return false
    return !recentAsks.some((ask) => (
      sourceOverlap(candidate, ask) || fuzzyAskTitleMatch(candidate.question, ask.title)
    ))
  })

  return eligible.sort((left, right) => right.leverage - left.leverage)[0] ?? null
}

function daysSince(date: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS))
}

async function gatherSignalBundle(
  userId: string,
  date: string,
  now: Date,
  recentAsks: KairosAskRow[],
): Promise<{ bundle: AskMineSignalBundle; validSourceIds: Set<string>; validDominionIds: Set<string> }> {
  const [
    aetherInputs,
    allDominions,
    reflectionRows,
    stale,
    recentlyCompleted,
    recentlyCreated,
    ownerToday,
  ] = await Promise.all([
    fetchAetherInputs(userId),
    findDominionsByUser(userId),
    listKairosReflectionStaleness(userId),
    listStaleTasks({ userId }),
    listRecentlyCompletedTasks({ userId }),
    listRecentlyCreatedTasks({ userId }),
    loadOwnerTodayForAskMine(userId),
  ])
  const liveDominions = allDominions.filter((dominion) => !dominion.archivedAt)
  const validDominionIds = new Set(liveDominions.map((dominion) => dominion.id))
  const latestAether = aetherInputs.prior
  const payload = latestAether?.payload
  const thoughtById = new Map(payload?.thoughts.map((thought) => [thought.id, thought]) ?? [])
  const questions = (payload?.thoughts ?? [])
    .filter((thought) => thought.kind === 'question' && thought.salience >= 0.7)
    .map((thought) => ({
      title: thought.title,
      insight: thought.insight,
      salience: thought.salience,
      dominionId: thought.dominionId,
      sourceMemoryIds: thought.sourceMemoryIds,
    }))
  const tensions = (payload?.tensions ?? []).map((tension) => {
    const left = thoughtById.get(tension.aId)
    const right = thoughtById.get(tension.bId)
    return {
      note: tension.note,
      leftTitle: left?.title ?? null,
      rightTitle: right?.title ?? null,
      dominionId: left?.dominionId === right?.dominionId ? (left?.dominionId ?? null) : null,
      sourceMemoryIds: [...new Set([
        ...(left?.sourceMemoryIds ?? []),
        ...(right?.sourceMemoryIds ?? []),
      ])],
    }
  }).filter((tension) => tension.sourceMemoryIds.length > 0)
  const cortexDrift = aetherInputs.cortexSnapshots.flatMap((cortex) => (
    cortex.driftSignals.map((signal) => ({
      sourceMemoryId: cortex.id,
      dominionId: cortex.dominionId,
      dominionName: cortex.dominionName,
      signal,
    }))
  ))
  const reflectionStaleness = reflectionRows.map((row) => ({
    dominionId: row.dominionId,
    dominionName: row.dominionName,
    daysSinceLastReflection: row.lastReflectedAt ? daysSince(row.lastReflectedAt, now) : null,
  }))
  const withSourceId = <T extends { taskId: string }>(task: T) => ({
    ...task,
    sourceMemoryId: task.taskId,
  })
  const board = {
    stale: stale.map(withSourceId),
    recentlyCompleted: recentlyCompleted.map(withSourceId),
    recentlyCreated: recentlyCreated.map(withSourceId),
  }
  const bundle: AskMineSignalBundle & { ownerSaidToday?: OwnerTodaySignal } = {
    date,
    aether: {
      memoryId: latestAether?.id ?? null,
      questions,
      tensions,
    },
    cortexDrift,
    board,
    reflectionStaleness,
    recentAsks: recentAsks.map((ask) => ({
      question: ask.title,
      dominionId: ask.dominionId,
      askedAt: ask.kairosAsk.askedAt,
      status: ask.kairosAsk.status,
      askMine: ask.askMine ?? null,
    })),
    ...(ownerToday ? { ownerSaidToday: ownerToday } : {}),
  }
  const validSourceIds = new Set<string>()
  for (const question of questions) question.sourceMemoryIds.forEach((id) => validSourceIds.add(id))
  for (const tension of tensions) tension.sourceMemoryIds.forEach((id) => validSourceIds.add(id))
  cortexDrift.forEach((signal) => validSourceIds.add(signal.sourceMemoryId))
  Object.values(board).flat().forEach((signal) => validSourceIds.add(signal.sourceMemoryId))

  return { bundle, validSourceIds, validDominionIds }
}

// ─── thin-card nudge (fallback when nothing better is worth asking) ───────

const CARD_NOTES_MAX = 3
const CARD_NOTES_LEVERAGE = 0.5

async function tryCardNotesAsk(
  userId: string,
  date: string,
  now: Date,
): Promise<Extract<AskMineRunResult, { status: 'created' }> | null> {
  try {
    const pageDate = previousDate(date, 1)
    const pages = await listBoardDayPages(userId, pageDate)
    const cards: ThinCard[] = []
    const pageIds: string[] = []
    const dominionIds = new Set<string | null>()
    for (const page of pages) {
      const thin = thinCardsFromPage(page).slice(0, CARD_NOTES_MAX - cards.length)
      if (thin.length === 0) continue
      cards.push(...thin)
      pageIds.push(page.id)
      dominionIds.add(page.dominionId)
      if (cards.length >= CARD_NOTES_MAX) break
    }
    if (cards.length === 0) return null

    const sourceMemoryIds = [...pageIds, ...cards.flatMap((card) => (card.taskId ? [card.taskId] : []))]
    const dominionId = dominionIds.size === 1 ? [...dominionIds][0] ?? null : null
    const expiresAt = new Date(now.getTime() + ASK_EXPIRY_MS).toISOString()
    const askId = await createKairosAskMemory(userId, {
      question: buildCardNotesQuestion(cards.map((card) => card.title)),
      dominionId,
      aetherMemoryId: '',
      sourceThoughtId: null,
      sourceMemoryIds,
      askedAt: now.toISOString(),
      expiresAt,
      externalId: `ask-mine:${date}:card-notes`,
      askMine: {
        date,
        kind: 'card_notes',
        sourceMemoryIds,
        leverage: CARD_NOTES_LEVERAGE,
        rationale: `${cards.length} card(s) finished on ${pageDate} with a title only — a line each turns them into evidence and gets written back onto the card.`,
      },
      cardNotes: { date: pageDate, boardDayMemoryIds: pageIds, cards },
    })
    return { status: 'created', date, askId, kind: 'card_notes', cardCount: cards.length, expiresAt }
  } catch (error) {
    console.error('[ask-mine] card-notes nudge failed; falling back to skip', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// Cheap gates, before any signal read: a full backlog of open asks, an
// unanswered outbound message, or an ask already mined for `date` each end the
// night for this user. Open asks below the cap do NOT block: Kairos keeps
// asking one new question a day (the duplicate guard prevents repeats).
export async function askMineGate(
  userId: string,
  date: string,
  now: Date,
): Promise<{ skip: AskMineGateReason } | { skip: null; recentAsks: KairosAskRow[] }> {
  const open = await listOpenKairosAsks(userId, now)
  if (open.length >= ASK_BACKLOG_MAX) {
    console.info('[ask-mine] open-ask backlog full; skipping user', { userId, open: open.length })
    return { skip: 'backlog_full' }
  }
  const conversation = await getConversationState(userId)
  if (conversation.awaitingReply) {
    console.info('[ask-mine] outbound reply outstanding; skipping user', { userId })
    return { skip: 'awaiting_reply' }
  }
  const recentAsks = await listRecentKairosAsks(userId, ASK_DEDUP_LOOKBACK_DAYS, now)
  if (recentAsks.some((ask) => ask.askMine?.date === date)) {
    return { skip: 'already_ran' }
  }
  return { skip: null, recentAsks }
}

export interface PreparedAskMine {
  status: 'ready'
  date: string
  recentAsks: KairosAskRow[]
  bundle: AskMineSignalBundle
  validSourceIds: Set<string>
  validDominionIds: Set<string>
  modelInput: ModelInput
}

// Shared by the 04:30 cron and the ask_mine thinking job: gates, the signal
// bundle and the exact model input. A routine that already answered tonight's
// ask_mine job counts as already_ran, so the cron never calls the model.
export async function prepareAskMine(
  userId: string,
  now: Date,
  options: { date?: string } = {},
): Promise<PreparedAskMine | { status: 'skipped'; date: string; reason: AskMineGateReason }> {
  const date = resolveDate(options.date, now)
  const gate = await askMineGate(userId, date, now)
  if (gate.skip) return { status: 'skipped', date, reason: gate.skip }
  if (await isJobDone(userId, askMineJobKey(date))) {
    return { status: 'skipped', date, reason: 'already_ran' }
  }
  const { bundle, validSourceIds, validDominionIds } = await gatherSignalBundle(
    userId,
    date,
    now,
    gate.recentAsks,
  )
  return {
    status: 'ready',
    date,
    recentAsks: gate.recentAsks,
    bundle,
    validSourceIds,
    validDominionIds,
    modelInput: {
      system: ASK_MINE_SYSTEM_PROMPT,
      prompt: buildAskMineUserPrompt(bundle),
      cacheSystem: true,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  }
}

export interface FinishAskMineInput {
  date: string
  now: Date
  candidates: AskMineCandidate[]
  validSourceIds: ReadonlySet<string>
  validDominionIds: ReadonlySet<string>
  aetherMemoryId: string | null
  // Omitted -> re-read, so a routine answer is deduped against asks made
  // since its job was planned.
  recentAsks?: KairosAskRow[]
}

// The one write path for a mined ask (cron and thinking job): ground the
// parsed candidates, pick one, persist it — or fall back to the thin-card
// nudge when nothing is eligible.
export async function finishAskMine(
  userId: string,
  input: FinishAskMineInput,
): Promise<Exclude<AskMineRunResult, { status: 'dry_run' }>> {
  const { date, now } = input
  const groundedCandidates = input.candidates.filter((candidate) => (
    (!candidate.dominionId || input.validDominionIds.has(candidate.dominionId))
    && candidate.sourceMemoryIds.every((id) => input.validSourceIds.has(id))
  ))
  const recentAsks = input.recentAsks ?? await listRecentKairosAsks(userId, ASK_DEDUP_LOOKBACK_DAYS, now)
  const candidate = selectAskMineCandidate(groundedCandidates, recentAsks, date)
  if (!candidate) {
    return (await tryCardNotesAsk(userId, date, now)) ?? { status: 'skipped', date, reason: 'no_candidate' }
  }

  const askedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + ASK_EXPIRY_MS).toISOString()
  const askId = await createKairosAskMemory(userId, {
    question: candidate.question,
    dominionId: candidate.dominionId ?? null,
    aetherMemoryId: input.aetherMemoryId ?? '',
    sourceThoughtId: null,
    sourceMemoryIds: candidate.sourceMemoryIds,
    askedAt,
    expiresAt,
    externalId: `ask-mine:${date}:1`,
    askMine: {
      date,
      kind: candidate.kind,
      sourceMemoryIds: candidate.sourceMemoryIds,
      leverage: candidate.leverage,
      // Persisted so the chat surface can quote WHY this was asked instead
      // of reconstructing it from kind/leverage (WP3 reads it when present).
      rationale: candidate.rationale,
    },
  })
  return { status: 'created', date, askId, candidate, expiresAt }
}

export async function runAskMineForUser(
  userId: string,
  options: AskMineOptions = {},
): Promise<AskMineRunResult> {
  const now = options.now ?? new Date()
  const prepared = await prepareAskMine(userId, now, { date: options.date })
  if (prepared.status === 'skipped') return prepared
  const { date, validSourceIds, modelInput } = prepared
  if (validSourceIds.size === 0) {
    if (!options.dryRun) {
      const nudge = await tryCardNotesAsk(userId, date, now)
      if (nudge) return nudge
    }
    return { status: 'skipped', date, reason: 'no_signals' }
  }
  if (options.dryRun) {
    return { status: 'dry_run', date, modelInput, signalCount: validSourceIds.size }
  }

  try {
    const { provider } = await getProviderForTask(userId, {
      taskType: 'reflect',
      dominionId: null,
    })
    const response = await provider.ask(modelInput)
    return await finishAskMine(userId, {
      date,
      now,
      candidates: parseAskMineResponse(response.text.trim()),
      validSourceIds,
      validDominionIds: prepared.validDominionIds,
      aetherMemoryId: prepared.bundle.aether.memoryId,
      recentAsks: prepared.recentAsks,
    })
  } catch (error) {
    if (error instanceof AiCredentialMissingError) {
      return { status: 'skipped', date, reason: 'no_credential' }
    }
    if (error instanceof AiCredentialDecryptError) {
      return { status: 'skipped', date, reason: 'key_undecryptable' }
    }
    throw error
  }
}

export { parseAskMineResponse }
export { buildCardNotesQuestion }

// ─── expiry sweep (docs/kairos/34 §6) ─────────────────────────────────────

export interface ExpiredAskSweepResult {
  examined: number
  expired: number
}

/**
 * Persist every pending ask past its expiresAt as 'expired' and log an
 * Outcome negative on it — an unanswered question is a miss. Idempotent: the
 * status write is guarded on still-pending, and only the winning write
 * reacts, so a re-run (or an answer racing the sweep) never double-counts.
 *
 * Accepted non-atomicity: the status write and the Outcome reaction are two
 * transactions. reactOutcome is best-effort (logs + swallows), so a failed
 * reaction leaves the ask 'expired' without its negative outcome — the sweep
 * never re-reacts (the guarded claim is already won). One missed −1 on a
 * single question is cheaper than coupling the sweep to the reaction path.
 */
export async function sweepExpiredKairosAsks(userId: string, now: Date = new Date()): Promise<ExpiredAskSweepResult> {
  const ids = await listExpiredPendingKairosAskIds(userId, now)
  let expired = 0
  for (const id of ids) {
    if (!(await markKairosAskExpired(userId, id, now))) continue
    expired += 1
    await reactOutcome(userId, id, 'negative', 'kairos ask expired unanswered')
  }
  return { examined: ids.length, expired }
}
