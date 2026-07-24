import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
import { listRecentlyCompletedTasks, listRecentlyCreatedTasks } from '@/lib/data/board-signals'
import { listKairosAsksAnsweredBetween } from '@/lib/data/ask'
import { listTraceHistory } from '@/lib/data/recipes'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import { SYNTHESIS_HEALTH_RECIPE } from './synthesis-health'
import { deliverKairosSpeak } from './speak'
import { writeCronFailureTrace } from './cron-trace'
import { todayIso } from './_prompt-utils'
import { DIGEST_SYSTEM_PROMPT, buildDigestUserPrompt } from './digest-prompt'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Evening Digest — one guaranteed-daily message: what Kairos saw
// today, what he formulated. Unlike the brain-tick (silence-by-default,
// docs/kairos/29), this is a fixed daily register — it always sends,
// falling back to a deterministic (zero-model) narrative if the provider
// call fails so the operator never gets a night of total silence.
//
// Single-operator convention (matches /api/v1/kairos/speak + the
// synthesis-health 2-strike alert): driven by KAIROS_OPERATOR_USER_ID, no
// per-user loop.
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

export interface DigestWindow {
  start: Date
  end: Date
}

export interface SynthesisSnapshot {
  green: number
  failed: number
  failedStages: string[]
}

export interface DigestCounts {
  codingSessions: number
  introspectionProposals: number
  reflections: number
  asksDispatched: number
  asksAnswered: number
  boardTasksCompleted: number
  boardTasksCreated: number
  synthesis: SynthesisSnapshot | null
}

async function countMemories(userId: string, extra: SQL[], window: DigestWindow): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      ...extra,
      gte(memories.createdAt, window.start),
      lt(memories.createdAt, window.end),
    ))
  return row?.n ?? 0
}

// Reduces a synthesis-health rollup's byStage map (stage -> {night: status})
// to "as of its most recent tracked night" per stage. The rollup itself only
// materialises once per UTC day (08:00Z, before this cron's 18:00Z slot) —
// gatherDigestCounts depends on that ordering and reports "no signal" rather
// than "healthy" when no rollup exists yet for today.
function summariseSynthesis(byStage: Record<string, Record<string, 'ok' | 'failed'>>): SynthesisSnapshot {
  let green = 0
  const failedStages: string[] = []
  for (const [stage, nights] of Object.entries(byStage)) {
    const latestNight = Object.keys(nights).sort().at(-1)
    if (!latestNight) continue
    if (nights[latestNight] === 'ok') green++
    else failedStages.push(stage)
  }
  failedStages.sort()
  return { green, failed: failedStages.length, failedStages }
}

export async function gatherDigestCounts(userId: string, window: DigestWindow): Promise<DigestCounts> {
  const [
    codingSessions,
    introspectionProposals,
    reflections,
    asksDispatched,
    answeredAsks,
    completedTasks,
    createdTasks,
    synthesisRollup,
  ] = await Promise.all([
    countMemories(userId, [eq(memories.type, 'session_summary'), eq(memories.source, 'claude')], window),
    countMemories(userId, [eq(memories.type, 'inbound'), sql`${memories.sourceMetadata}->>'introspection' = 'true'`], window),
    countMemories(userId, [eq(memories.type, 'reflection'), eq(memories.streamClass, 'reflection')], window),
    countMemories(userId, [eq(memories.type, 'advisory'), sql`${memories.sourceMetadata} ? 'kairosAsk'`], window),
    listKairosAsksAnsweredBetween(userId, window.start, window.end),
    listRecentlyCompletedTasks({ userId, days: 1 }),
    listRecentlyCreatedTasks({ userId, days: 1 }),
    listTraceHistory(userId, { recipe: SYNTHESIS_HEALTH_RECIPE, limit: 1 }),
  ])

  const rollup = synthesisRollup[0]
  const byStage = rollup ? (rollup.sourceMetadata as Record<string, unknown> | null)?.byStage : undefined
  const synthesis = byStage && typeof byStage === 'object'
    ? summariseSynthesis(byStage as Record<string, Record<string, 'ok' | 'failed'>>)
    : null

  return {
    codingSessions,
    introspectionProposals,
    reflections,
    asksDispatched,
    asksAnswered: answeredAsks.length,
    boardTasksCompleted: completedTasks.length,
    boardTasksCreated: createdTasks.length,
    synthesis,
  }
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// The guaranteed-delivery fallback: pure string template, zero model
// dependency, so a provider outage never costs the operator their nightly
// digest — only its narrative polish.
export function buildDeterministicDigest(counts: DigestCounts, date: string): string {
  const activity: string[] = []
  if (counts.codingSessions > 0) activity.push(plural(counts.codingSessions, 'coding session'))
  if (counts.introspectionProposals > 0) activity.push(plural(counts.introspectionProposals, 'introspection proposal'))
  if (counts.reflections > 0) activity.push(plural(counts.reflections, 'reflection'))
  if (counts.boardTasksCompleted > 0) activity.push(`${plural(counts.boardTasksCompleted, 'board task')} completed`)
  if (counts.boardTasksCreated > 0) activity.push(`${plural(counts.boardTasksCreated, 'board task')} created`)

  const lines: string[] = [
    `Evening digest · ${date}`,
    '',
    activity.length > 0
      ? `Today I saw ${joinNatural(activity)}.`
      : 'A quiet day — nothing landed on my side today.',
  ]

  if (counts.asksDispatched > 0) {
    lines.push(`I dispatched ${plural(counts.asksDispatched, 'ask')}, ${counts.asksAnswered} answered so far.`)
  }

  if (counts.synthesis === null) {
    lines.push('No overnight synthesis-health signal yet for today.')
  } else if (counts.synthesis.failed === 0) {
    lines.push(`Overnight synthesis ran clean across ${plural(counts.synthesis.green, 'stage')}.`)
  } else {
    lines.push(`Overnight synthesis: ${plural(counts.synthesis.failed, 'stage')} not healthy (${counts.synthesis.failedStages.join(', ')}).`)
  }

  return lines.join('\n')
}

async function alreadyRanToday(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'inbound'),
      eq(memories.source, 'system'),
      sql`${memories.sourceMetadata}->>'kairosSpeak' = 'true'`,
      sql`${memories.sourceMetadata}->>'digest' = 'true'`,
      sql`${memories.createdAt} >= DATE_TRUNC('day', NOW())`,
    ))
  return (row?.n ?? 0) > 0
}

export type DigestRunStatus = 'sent' | 'sent_fallback' | 'skipped'

export interface EveningDigestResult {
  status: DigestRunStatus
  reason?: string
  date?: string
}

export async function runEveningDigestForUser(userId: string): Promise<EveningDigestResult> {
  try {
    if (await alreadyRanToday(userId)) {
      return { status: 'skipped', reason: 'already ran today' }
    }

    const date = todayIso()
    const start = new Date(`${date}T00:00:00.000Z`)
    const end = new Date(start.getTime() + DAY_MS)

    const counts = await gatherDigestCounts(userId, { start, end })

    let message: string
    let sentFallback = false

    try {
      const { provider } = await getProviderForTask(userId, { taskType: 'digest' })
      const response = await provider.ask({
        system: DIGEST_SYSTEM_PROMPT,
        prompt: buildDigestUserPrompt(counts, date),
        cacheSystem: true,
        maxTokens: 1500,
      })
      const text = response.text.trim()
      if (!text) throw new Error('digest: empty response from provider')
      message = text
    } catch (err) {
      message = buildDeterministicDigest(counts, date)
      sentFallback = true
      // The promise is one message every evening regardless — even on a
      // benign missing/undecryptable BYOK credential we still send the
      // deterministic fallback; only the trace write is skipped for those,
      // matching writeCronFailureTrace's "expected skip, not a failure" contract.
      const benign = err instanceof AiCredentialMissingError || err instanceof AiCredentialDecryptError
      if (!benign) {
        await writeCronFailureTrace(userId, { cronName: 'digest', reason: 'model_call_failed', error: err })
      }
    }

    await deliverKairosSpeak(userId, {
      title: `Evening digest · ${date}`,
      message,
      kind: 'notify',
      urgency: 'normal',
      force: true,
      opsAlert: false,
      digest: true,
    })

    return { status: sentFallback ? 'sent_fallback' : 'sent', date }
  } catch (err) {
    await writeCronFailureTrace(userId, { cronName: 'digest', reason: 'uncaught_exception', error: err })
    return { status: 'skipped', reason: err instanceof Error ? err.message : String(err) }
  }
}
