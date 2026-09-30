import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
import { countTasksCompletedBetween, countTasksCreatedBetween } from '@/lib/data/board-signals'
import { listKairosAsksAnsweredBetween } from '@/lib/data/ask'
import { listTraceHistory } from '@/lib/data/recipes'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import { SYNTHESIS_HEALTH_RECIPE } from './synthesis-health'
import { deliverKairosSpeak } from './speak'
import { writeCronFailureTrace, writeCronSuccessTrace } from './cron-trace'
import { todayIso } from './_prompt-utils'
import { DIGEST_SYSTEM_PROMPT, MAX_DIGEST_BELIEFS, buildBeliefsBlock, buildDigestUserPrompt } from './digest-prompt'
import { listPromotedBeliefsBetween, type PromotedBelief } from '@/lib/data/memory-candidates'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Evening Digest — one guaranteed-daily message: what Kairos saw
// in the last 24h, what he formulated. Unlike the brain-tick (silence-by-default,
// docs/kairos/29), this is a fixed daily register — it always sends,
// falling back to a deterministic (zero-model) narrative if the provider
// call fails, or to a minimal trace-log pointer if even gathering the
// day's counts fails, so the operator never gets a night of total silence.
//
// Single-operator convention (matches /api/v1/kairos/speak + the
// synthesis-health 2-strike alert): driven by KAIROS_OPERATOR_USER_ID, no
// per-user loop.
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DIGEST_CHARS = 1200
// Non-digest content signals: markdown headings, links, export footers — the
// 27/09 runaway (model free-ran into a memorised WordPress manual) had all three.
const JUNK_OUTPUT_RE = /^#{1,6}\s|https?:\/\/|Powered by/im

export interface DigestWindow {
  start: Date
  end: Date
}

export interface SynthesisSnapshot {
  green: number
  failed: number
  failedStages: string[]
}

// Rolling 24h ending at run time. The cron fires at 18:00Z, so a UTC
// calendar-day window silently dropped 18:00-24:00Z activity every night;
// this window starts at the previous run slot instead.
export function digestWindow(now: Date): DigestWindow {
  return { start: new Date(now.getTime() - DAY_MS), end: now }
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
// Empty/absent byStage means no rollup has meaningfully materialised
// (nothing to summarise) — treated the same as "no signal", never as
// "0 stages, all healthy".
function summariseSynthesis(byStage: Record<string, Record<string, 'ok' | 'failed'>>): SynthesisSnapshot | null {
  if (Object.keys(byStage).length === 0) return null
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
    boardTasksCompleted,
    boardTasksCreated,
    synthesisRollup,
  ] = await Promise.all([
    countMemories(userId, [
      eq(memories.type, 'session_summary'),
      sql`(${memories.source} in ('claude', 'codex', 'copilot') or (${memories.source} = 'hook' and ${memories.sourceMetadata}->>'client' in ('codex', 'copilot')))`,
    ], window),
    countMemories(userId, [eq(memories.type, 'inbound'), sql`${memories.sourceMetadata}->>'introspection' = 'true'`], window),
    countMemories(userId, [eq(memories.type, 'reflection'), eq(memories.streamClass, 'reflection')], window),
    countMemories(userId, [eq(memories.type, 'advisory'), sql`${memories.sourceMetadata} ? 'kairosAsk'`], window),
    listKairosAsksAnsweredBetween(userId, window.start, window.end),
    countTasksCompletedBetween(userId, window.start, window.end),
    countTasksCreatedBetween(userId, window.start, window.end),
    listTraceHistory(userId, { recipe: SYNTHESIS_HEALTH_RECIPE, limit: 1 }),
  ])

  // Only trust the rollup if it materialised inside this digest's window — an absent
  // or stale (yesterday-or-older) rollup must fall through to "no signal",
  // never masquerade as tonight's health.
  const rollup = synthesisRollup[0]
  const isFreshRollup = rollup !== undefined && rollup.createdAt >= window.start
  const byStage = isFreshRollup ? (rollup.sourceMetadata as Record<string, unknown> | null)?.byStage : undefined
  const synthesis = byStage && typeof byStage === 'object'
    ? summariseSynthesis(byStage as Record<string, Record<string, 'ok' | 'failed'>>)
    : null

  return {
    codingSessions,
    introspectionProposals,
    reflections,
    asksDispatched,
    asksAnswered: answeredAsks.length,
    boardTasksCompleted,
    boardTasksCreated,
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
      ? `In the last 24h I saw ${joinNatural(activity)}.`
      : 'A quiet day — nothing landed on my side in the last 24h.',
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

// The last-resort fallback when even gatherDigestCounts fails — no counts to
// narrate at all, but the operator still hears from Kairos every night.
function buildMinimalDigest(date: string): string {
  return [
    `Evening digest · ${date}`,
    '',
    "I couldn't tally the last 24h of activity, but I'm here. Details are in my trace log.",
  ].join('\n')
}

// Memory-engine promotions in the window, oldest first (≤3). Best-effort and
// deliberately untraced: an empty block is the correct output when the engine
// hasn't run (or memory_ops isn't migrated yet), and must never cost the
// operator the digest itself.
export async function gatherPromotedBeliefs(userId: string, window: DigestWindow): Promise<PromotedBelief[]> {
  try {
    return await listPromotedBeliefsBetween(userId, window.start, window.end, MAX_DIGEST_BELIEFS)
  } catch {
    return []
  }
}

// Idempotency stays keyed on the UTC calendar day (independent of the rolling
// count window) so the digest sends once per day. dayStart is passed in rather
// than DATE_TRUNC('day', NOW()) so it is independent of the DB session timezone.
async function alreadyRanToday(userId: string, dayStart: Date): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'inbound'),
      eq(memories.source, 'system'),
      sql`${memories.sourceMetadata}->>'kairosSpeak' = 'true'`,
      sql`${memories.sourceMetadata}->>'digest' = 'true'`,
      gte(memories.createdAt, dayStart),
    ))
  return (row?.n ?? 0) > 0
}

export type DigestRunStatus = 'sent' | 'sent_fallback' | 'blocked' | 'skipped'

export interface EveningDigestResult {
  status: DigestRunStatus
  reason?: string
  date?: string
}

export async function runEveningDigestForUser(userId: string): Promise<EveningDigestResult> {
  try {
    const date = todayIso()
    const dayStart = new Date(`${date}T00:00:00.000Z`)

    if (await alreadyRanToday(userId, dayStart)) {
      await writeCronSuccessTrace(userId, { cronName: 'digest', outcome: 'skipped', skipReason: 'already ran today' })
      return { status: 'skipped', reason: 'already ran today' }
    }

    // Gather failure must not mean total silence: fall through to the
    // minimal message below rather than letting the outer catch skip the
    // whole night.
    let counts: DigestCounts | null = null
    const window = digestWindow(new Date())
    try {
      counts = await gatherDigestCounts(userId, window)
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: 'digest', reason: 'gather_failed', error: err })
    }

    let message: string
    let sentFallback = false

    if (counts === null) {
      message = buildMinimalDigest(date)
      sentFallback = true
    } else {
      let finishReason: string | undefined
      let rawText: string | undefined
      try {
        const { provider } = await getProviderForTask(userId, { taskType: 'digest' })
        const response = await provider.ask({
          system: DIGEST_SYSTEM_PROMPT,
          prompt: buildDigestUserPrompt(counts, date),
          cacheSystem: true,
          maxTokens: 1500,
        })
        finishReason = response.finishReason
        const text = response.text.trim()
        rawText = text
        if (!text) throw new Error('digest: empty response from provider')
        if (finishReason !== 'stop') throw new Error(`digest: finishReason=${finishReason}`)
        if (text.length > MAX_DIGEST_CHARS || JUNK_OUTPUT_RE.test(text)) {
          throw new Error('digest: output rejected by guard')
        }
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
          await writeCronFailureTrace(userId, {
            cronName: 'digest',
            reason: 'model_call_failed',
            error: err,
            ...(finishReason !== undefined ? { finishReason } : {}),
            ...(rawText ? { rawExcerpt: rawText.slice(0, 500) } : {}),
          })
        }
      }
    }

    // Deterministic "What I now believe" block, appended after the narrative
    // guard so the P0 runaway/length guards still judge only model text.
    const beliefsBlock = buildBeliefsBlock(await gatherPromotedBeliefs(userId, window))
    if (beliefsBlock) message = `${message}\n\n${beliefsBlock}`

    // force:true only bypasses the awaitingReply gate, not the forced-speak
    // ceiling in speak.ts — a 429 here means real delivery failure, not a
    // benign skip, so it must be traced and reported distinctly (F1).
    const outcome = await deliverKairosSpeak(userId, {
      title: `Evening digest · ${date}`,
      message,
      kind: 'notify',
      urgency: 'normal',
      force: true,
      opsAlert: false,
      digest: true,
      externalId: `kairos-digest:${date}`,
    })

    if (outcome.status !== 200) {
      await writeCronFailureTrace(userId, {
        cronName: 'digest',
        reason: 'delivery_blocked',
        error: new Error(`kairos-speak blocked delivery with status ${outcome.status}`),
        rawExcerpt: JSON.stringify(outcome.body).slice(0, 500),
      })
      return { status: 'blocked', date }
    }

    await writeCronSuccessTrace(userId, { cronName: 'digest' })
    return { status: sentFallback ? 'sent_fallback' : 'sent', date }
  } catch (err) {
    await writeCronFailureTrace(userId, { cronName: 'digest', reason: 'uncaught_exception', error: err })
    return { status: 'skipped', reason: err instanceof Error ? err.message : String(err) }
  }
}
