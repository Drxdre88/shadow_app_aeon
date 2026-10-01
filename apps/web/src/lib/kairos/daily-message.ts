import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { listJobs } from '@/lib/data/thinking-jobs'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialDecryptError, AiCredentialMissingError } from '@/lib/ai/router'
import type { ThinkingJobKind, ThinkingJobRow } from '@/lib/kairos/engine/types'
import { deliverKairosSpeak, type SpeakInput, type SpeakOutcome } from './speak'
import { writeCronFailureTrace, writeCronSuccessTrace } from './cron-trace'
import { gatherDailyMessageInputs } from './daily-message-inputs'
import { loadConscienceBlock } from './conscience-context'
import {
  DAILY_MESSAGE_SYSTEM_PROMPT,
  buildBeliefsBlock,
  buildDailyMessageUserPrompt,
  buildDeterministicDailyMessage,
  londonDate,
  parseDailyMessageDraft,
  rejectMessageText,
  type DailyMessageInputs,
} from './daily-message-prompt'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Daily Message (docs/kairos/34 §3) — the one guaranteed push of the
// day, 08:00 Europe/London. Replaces the evening digest; the morning briefs
// still write advisories (sidebar/inbox) and feed this message.
//
// Draft source, in order: the Max routine's `daily_message` thinking job (if
// done today) → the paid heavy-tier key → a deterministic template. Every
// draft passes the same guard (length, no headings/URLs); the deterministic
// "What I now believe" block is appended after the guard. Delivered once per
// London date (single-flight advisory try-lock + externalId) via
// deliverKairosSpeak(digest:true) — excluded from the speak throttle and the
// awaiting-reply gate. Inbox-only delivery (Telegram failed) is reported as
// 'sent_inbox_only' with a failure trace.
// ─────────────────────────────────────────────────────────────────────────

export const DAILY_MESSAGE_CRON = 'daily-message'
export const DAILY_MESSAGE_KIND: ThinkingJobKind = 'daily_message'
export const dailyMessageJobKey = (date: string) => `daily_message:${date}`
export const dailyMessageExternalId = (date: string) => `kairos-daily:${date}`
const DAY_MS = 24 * 60 * 60 * 1000

export async function alreadyDelivered(userId: string, date: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      sql`${memories.sourceMetadata}->>'kairosSpeak' = 'true'`,
      sql`${memories.sourceMetadata}->>'externalId' = ${dailyMessageExternalId(date)}`,
    ))
  return (row?.n ?? 0) > 0
}

// ── Routine draft (thinking job) ─────────────────────────────────────────

// The daily_message handler returns the guarded draft as ApplyOutcome.output,
// which the queue merges into the completed job's `output`.
export function readJobDraft(job: Pick<ThinkingJobRow, 'output'>): string | null {
  const draft = job.output?.draft
  return typeof draft === 'string' && draft.trim() ? draft : null
}

async function findRoutineDraft(userId: string, date: string, now: Date): Promise<string | null> {
  const jobs = await listJobs(userId, { kind: DAILY_MESSAGE_KIND, since: new Date(now.getTime() - 2 * DAY_MS), limit: 10 })
  const job = jobs.find((j) => j.externalKey === dailyMessageJobKey(date) && j.status === 'done')
  return job ? readJobDraft(job) : null
}

// ── Compose ──────────────────────────────────────────────────────────────

export type DraftSource = 'routine' | 'api' | 'deterministic'

export interface ComposedDailyMessage {
  message: string
  source: DraftSource
  inputs: DailyMessageInputs
}

async function composeWithModel(userId: string, inputs: DailyMessageInputs): Promise<string> {
  let finishReason: string | undefined
  let rawText: string | undefined
  try {
    const { provider } = await getProviderForTask(userId, { taskType: 'digest' })
    // Same conscience block as the routine draft (handlers/daily-message.ts);
    // never throws — '' on a fetch failure.
    const conscience = await loadConscienceBlock(userId)
    const response = await provider.ask({
      system: DAILY_MESSAGE_SYSTEM_PROMPT,
      prompt: buildDailyMessageUserPrompt(inputs, conscience),
      cacheSystem: true,
      maxTokens: 1500,
    })
    finishReason = response.finishReason
    rawText = response.text.trim()
    if (finishReason !== 'stop') throw new Error(`daily-message: finishReason=${finishReason}`)
    const parsed = parseDailyMessageDraft(rawText)
    if (!parsed.ok) throw new Error(`daily-message: ${parsed.reason}`)
    return parsed.message
  } catch (err) {
    // Benign missing/undecryptable BYOK credential: still deterministic, but
    // not a traced failure (writeCronFailureTrace's "expected skip" contract).
    if (!(err instanceof AiCredentialMissingError || err instanceof AiCredentialDecryptError)) {
      await writeCronFailureTrace(userId, {
        cronName: DAILY_MESSAGE_CRON,
        reason: 'model_call_failed',
        error: err,
        ...(finishReason !== undefined ? { finishReason } : {}),
        ...(rawText ? { rawExcerpt: rawText.slice(0, 500) } : {}),
      })
    }
    throw err
  }
}

export async function composeDailyMessage(userId: string, now: Date): Promise<ComposedDailyMessage> {
  const inputs = await gatherDailyMessageInputs(userId, now)

  let message: string | null = null
  let source: DraftSource = 'deterministic'
  try {
    // Re-guarded: the draft was guarded at apply time, but the guard is the
    // delivery contract, so it is checked again on the text actually sent.
    const draft = (await findRoutineDraft(userId, inputs.date, now))?.trim()
    if (draft && rejectMessageText(draft) === null) {
      message = draft
      source = 'routine'
    }
  } catch (err) {
    console.warn('[kairos:daily-message] routine draft lookup failed:', err instanceof Error ? err.message : err)
  }

  if (message === null) {
    try {
      message = await composeWithModel(userId, inputs)
      source = 'api'
    } catch {
      message = buildDeterministicDailyMessage(inputs)
      source = 'deterministic'
    }
  }

  const beliefsBlock = buildBeliefsBlock(inputs.promotions ?? [])
  if (beliefsBlock) message = `${message}\n\n${beliefsBlock}`
  return { message, source, inputs }
}

// ── Run ──────────────────────────────────────────────────────────────────

export type DailyMessageRunStatus = 'sent' | 'sent_fallback' | 'sent_inbox_only' | 'dry_run' | 'blocked' | 'skipped'

export interface DailyMessageResult {
  status: DailyMessageRunStatus
  date?: string
  source?: DraftSource
  reason?: string
  message?: string
  failedInputs?: string[]
}

// Single-flight delivery. captureMemory's externalId dedup is check-then-
// insert, so two overlapping runs (a manual ?force=1 during the scheduled
// slot, a platform retry) could both pass it and both fan out to Telegram. A
// transaction-scoped TRY-lock on (userId, 'kairos-daily:<date>') makes the
// re-check + delivery single-flight: the loser returns 'in_flight' at once
// instead of queueing behind a Telegram send. The key differs from
// captureMemory's own session-capture lock, so the speak write (another pool
// connection) cannot deadlock against it.
export type DailyDeliveryFlight =
  | { state: 'in_flight' }
  | { state: 'already_delivered' }
  | { state: 'delivered'; outcome: SpeakOutcome }

export async function deliverDailyMessageOnce(
  userId: string,
  date: string,
  input: SpeakInput,
): Promise<DailyDeliveryFlight> {
  return db.transaction(async (tx): Promise<DailyDeliveryFlight> => {
    const res = await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtext(${userId}), hashtext(${dailyMessageExternalId(date)})) as locked`,
    )
    const locked = (res.rows[0] as { locked?: unknown } | undefined)?.locked === true
    if (!locked) return { state: 'in_flight' }
    if (await alreadyDelivered(userId, date)) return { state: 'already_delivered' }
    return { state: 'delivered', outcome: await deliverKairosSpeak(userId, input) }
  })
}

export async function runDailyMessageForUser(
  userId: string,
  opts: { now?: Date; dryRun?: boolean } = {},
): Promise<DailyMessageResult> {
  const now = opts.now ?? new Date()
  const date = londonDate(now)
  const skip = async (reason: string): Promise<DailyMessageResult> => {
    await writeCronSuccessTrace(userId, { cronName: DAILY_MESSAGE_CRON, outcome: 'skipped', skipReason: reason, now })
    return { status: 'skipped', reason, date }
  }
  try {
    // Cheap early exit before composing; re-checked under the lock below.
    if (!opts.dryRun && await alreadyDelivered(userId, date)) return await skip('already sent today')

    const { message, source, inputs } = await composeDailyMessage(userId, now)
    if (opts.dryRun) return { status: 'dry_run', date, source, message, failedInputs: inputs.failed }

    const flight = await deliverDailyMessageOnce(userId, date, {
      title: `Kairos · ${date}`,
      message,
      kind: 'notify',
      urgency: 'normal',
      force: true,
      opsAlert: false,
      digest: true,
      externalId: dailyMessageExternalId(date),
    })
    if (flight.state === 'in_flight') return await skip('delivery in flight')
    if (flight.state === 'already_delivered') return await skip('already sent today')

    const { outcome } = flight
    if (outcome.status !== 200) {
      await writeCronFailureTrace(userId, {
        cronName: DAILY_MESSAGE_CRON,
        reason: 'delivery_blocked',
        error: new Error(`kairos-speak blocked delivery with status ${outcome.status}`),
        rawExcerpt: JSON.stringify(outcome.body).slice(0, 500),
      })
      return { status: 'blocked', date, source }
    }
    if (outcome.body.alreadyDelivered) return await skip('already sent today')

    const failedInputs = inputs.failed.length ? { failedInputs: inputs.failed } : {}
    // The message is in the Will inbox but Telegram did not get it (channel
    // unconfigured or the API failed). Not retried: the inbox row now holds
    // today's externalId, and nothing but speak may talk to Telegram. A
    // failure trace (instead of the ok trace) makes it visible in health.
    if (!outcome.body.delivered.telegram) {
      await writeCronFailureTrace(userId, {
        cronName: DAILY_MESSAGE_CRON,
        reason: 'telegram_not_delivered',
        error: new Error(`daily message ${outcome.body.id} reached the inbox only — Telegram fan-out did not deliver`),
      })
      return { status: 'sent_inbox_only', date, source, ...failedInputs }
    }

    await writeCronSuccessTrace(userId, { cronName: DAILY_MESSAGE_CRON, now })
    return {
      status: source === 'deterministic' ? 'sent_fallback' : 'sent',
      date,
      source,
      ...failedInputs,
    }
  } catch (err) {
    await writeCronFailureTrace(userId, { cronName: DAILY_MESSAGE_CRON, reason: 'uncaught_exception', error: err })
    return { status: 'skipped', reason: err instanceof Error ? err.message : String(err), date }
  }
}
