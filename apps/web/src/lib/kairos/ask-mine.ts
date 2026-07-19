import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialDecryptError, AiCredentialMissingError } from '@/lib/ai/router'
import {
  createKairosAskMemory,
  getPendingKairosAsk,
  listKairosReflectionStaleness,
  listRecentKairosAsks,
  type KairosAskRow,
} from '@/lib/data/ask'
import {
  listRecentlyCompletedTasks,
  listRecentlyCreatedTasks,
  listStaleTasks,
} from '@/lib/data/board-signals'
import { findDominionsByUser } from '@/lib/data/dominions'
import { getConversationState } from './engagement'
import { fetchAetherInputs } from './aether'
import {
  ASK_MINE_SYSTEM_PROMPT,
  buildAskMineUserPrompt,
  parseAskMineResponse,
  type AskMineCandidate,
  type AskMineSignalBundle,
} from './ask-mine-prompt'

const DAY_MS = 86_400_000
const ASK_EXPIRY_MS = 72 * 60 * 60 * 1000
const MAX_OUTPUT_TOKENS = 4000
const FUZZY_MATCH_THRESHOLD = 0.6

const TITLE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'do', 'does', 'for', 'have', 'has', 'how', 'i', 'in', 'is', 'it',
  'of', 'on', 'or', 'our', 'should', 'still', 'the', 'this', 'to', 'we', 'what', 'when', 'which',
  'why', 'with', 'would', 'you', 'your',
])

export interface AskMineOptions {
  date?: string
  dryRun?: boolean
  now?: Date
}

export type AskMineRunResult =
  | { status: 'created'; date: string; askId: string; candidate: AskMineCandidate; expiresAt: string }
  | { status: 'dry_run'; date: string; modelInput: ModelInput; signalCount: number }
  | {
      status: 'skipped'
      date: string
      reason: 'pending' | 'awaiting_reply' | 'already_ran' | 'no_signals' | 'no_candidate' | 'no_credential' | 'key_undecryptable'
    }

interface ModelInput {
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
  ] = await Promise.all([
    fetchAetherInputs(userId),
    findDominionsByUser(userId),
    listKairosReflectionStaleness(userId),
    listStaleTasks({ userId }),
    listRecentlyCompletedTasks({ userId }),
    listRecentlyCreatedTasks({ userId }),
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
  const bundle: AskMineSignalBundle = {
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
  }
  const validSourceIds = new Set<string>()
  for (const question of questions) question.sourceMemoryIds.forEach((id) => validSourceIds.add(id))
  for (const tension of tensions) tension.sourceMemoryIds.forEach((id) => validSourceIds.add(id))
  cortexDrift.forEach((signal) => validSourceIds.add(signal.sourceMemoryId))
  Object.values(board).flat().forEach((signal) => validSourceIds.add(signal.sourceMemoryId))

  return { bundle, validSourceIds, validDominionIds }
}

export async function runAskMineForUser(
  userId: string,
  options: AskMineOptions = {},
): Promise<AskMineRunResult> {
  const now = options.now ?? new Date()
  const date = resolveDate(options.date, now)
  const pending = await getPendingKairosAsk(userId)
  if (pending) {
    console.info('[ask-mine] pending ask exists; skipping user', { userId, askId: pending.id })
    return { status: 'skipped', date, reason: 'pending' }
  }
  const conversation = await getConversationState(userId)
  if (conversation.awaitingReply) {
    console.info('[ask-mine] outbound reply outstanding; skipping user', { userId })
    return { status: 'skipped', date, reason: 'awaiting_reply' }
  }
  const recentAsks = await listRecentKairosAsks(userId, 14, now)
  if (recentAsks.some((ask) => ask.askMine?.date === date)) {
    return { status: 'skipped', date, reason: 'already_ran' }
  }
  const { bundle, validSourceIds, validDominionIds } = await gatherSignalBundle(
    userId,
    date,
    now,
    recentAsks,
  )
  if (validSourceIds.size === 0) return { status: 'skipped', date, reason: 'no_signals' }
  const modelInput: ModelInput = {
    system: ASK_MINE_SYSTEM_PROMPT,
    prompt: buildAskMineUserPrompt(bundle),
    cacheSystem: true,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
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
    const groundedCandidates = parseAskMineResponse(response.text.trim()).filter((candidate) => (
      (!candidate.dominionId || validDominionIds.has(candidate.dominionId))
      && candidate.sourceMemoryIds.every((id) => validSourceIds.has(id))
    ))
    const candidate = selectAskMineCandidate(groundedCandidates, recentAsks, date)
    if (!candidate) return { status: 'skipped', date, reason: 'no_candidate' }

    const askedAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + ASK_EXPIRY_MS).toISOString()
    const askId = await createKairosAskMemory(userId, {
      question: candidate.question,
      dominionId: candidate.dominionId ?? null,
      aetherMemoryId: bundle.aether.memoryId ?? '',
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
      },
    })
    return { status: 'created', date, askId, candidate, expiresAt }
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
