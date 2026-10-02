import { failJob, findJobById, listJobs, mergeJobOutput } from '@/lib/data/thinking-jobs'
import { isPaidBackupEnabled, PAID_BACKUP_OFF_NOTE } from '@/lib/kairos/paid-backup'
import type { ApplyOutcome, ThinkingJobKind, ThinkingJobRow } from '@/lib/kairos/engine/types'

// ─────────────────────────────────────────────────────────────────────────
// Chat on the Max plan — Telegram and the Kairos page (docs/kairos/34 §5,
// playbook docs/kairos/33 "Chat routine").
//
// The Telegram webhook or the web chat action persists the operator turn,
// queues a `chat` thinking job and fires the "Kairos chat" Claude Code
// routine through its API trigger. The routine claims the job over the Aeon
// MCP and submits the reply; the chat handler persists it (and sends it to
// Telegram for Telegram turns). A watchdog running in the caller's after()
// covers the job on the paid key when the routine is slow, rejected or never
// fired — unless the owner switched the paid backup off.
//
// Exactly one reply per turn rests on the job's atomic state transitions:
// the routine can only apply while the job is `claimed` and before its
// deadline; the watchdog takes a job over with a server-side failJob (any
// open status → failed), after which a routine submit is rejected. A claimed
// job is given until its deadline (+ grace) before the takeover, so a routine
// that is mid-answer is not raced by the fallback. If an apply still overruns
// the takeover, the reply ledger (chat-turn-reply.ts) settles it: both sides
// persist exclusively, attributed to the turn they answer, so only the first
// writes and sends.
// ─────────────────────────────────────────────────────────────────────────

// Parent adds 'chat' to ThinkingJobKind (docs/kairos/34 §7).
export const CHAT_JOB_KIND: ThinkingJobKind = 'chat'

export const DEFAULT_CHAT_ROUTINE_TIMEOUT_MS = 60_000
// Ceiling on KAIROS_CHAT_ROUTINE_TIMEOUT_MS. The webhook and the /kairos
// layout (web chat server actions) both have 300 s (maxDuration) for fire
// (≤10 s) + the watchdog wait (≤ timeout + slack +
// grace + one poll = 175 s at the ceiling) + the paid fallback (~115 s left).
export const MAX_CHAT_ROUTINE_TIMEOUT_MS = 120_000
export const DEFAULT_CHAT_ROUTINE_POLL_MS = 3_000
export const MAX_CHAT_ROUTINE_POLL_MS = 10_000
// Job deadline = timeout + slack: a routine that claimed near the timeout
// still has room to submit before the queue rejects it as late.
export const CHAT_JOB_DEADLINE_SLACK_MS = 30_000
// After a claimed job's deadline, wait this long for an in-flight apply
// (persist + Telegram send) before the paid fallback takes over.
export const CHAT_CLAIMED_GRACE_MS = 15_000
// The webhook's maxDuration (300 s): every watchdog fallback for a job ends
// within this long of the job's creation. Until then a job that was taken
// over (failed / expired) may still be answering its turn.
export const CHAT_JOB_OWNERSHIP_WINDOW_MS = 300_000

const FIRE_BETA = 'experimental-cc-routine-2026-04-01'
const FIRE_TIMEOUT_MS = 10_000
export const CHAT_ROUTINE_FIRE_TEXT = 'claim chat jobs'

export const CHAT_SUPERSEDED_PREFIX = 'superseded:'
export const CHAT_WATCHDOG_PREFIX = 'chat-watchdog:'

export const CHAT_REPLY_PENDING_MESSAGE =
  'Kairos is still answering this message — give him a minute.'

// Said instead of a paid-key answer when the routine missed the turn and the
// owner has switched the paid backup off.
export const CHAT_PAID_BACKUP_OFF_MESSAGE =
  "I couldn't answer on your Max plan just now — try again in a minute."

export type ChatChannel = 'telegram' | 'web'

function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  return raw === '1' || raw === 'true'
}

// One flag for both chat channels. KAIROS_TELEGRAM_ROUTINE is the pre-0.19
// name, still accepted so existing deployments keep working.
export function chatRoutineEnabled(): boolean {
  return envFlag('KAIROS_CHAT_ROUTINE') || envFlag('KAIROS_TELEGRAM_ROUTINE')
}

export const telegramRoutineEnabled = chatRoutineEnabled

function envMs(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export function chatRoutineTimeoutMs(): number {
  return Math.min(envMs('KAIROS_CHAT_ROUTINE_TIMEOUT_MS', DEFAULT_CHAT_ROUTINE_TIMEOUT_MS), MAX_CHAT_ROUTINE_TIMEOUT_MS)
}

export function chatRoutinePollMs(): number {
  return Math.min(envMs('KAIROS_CHAT_ROUTINE_POLL_MS', DEFAULT_CHAT_ROUTINE_POLL_MS), MAX_CHAT_ROUTINE_POLL_MS)
}

// The watchdog's hard stop, derived from the job's deadline so it never
// fires before a claimed job's deadline + grace: the deadline is created
// (timeout + slack) after the job, and the watchdog starts after the job, so
// timeout + slack + grace + one poll from the watchdog's start is past it.
export function chatWatchdogMaxWaitMs(timeoutMs: number, graceMs: number, pollMs: number): number {
  return timeoutMs + CHAT_JOB_DEADLINE_SLACK_MS + graceMs + pollMs
}

export interface ChatRoutineConfig {
  fireUrl: string
  token: string
}

// ROUTINE_CHAT_ID (trig_… from the API-trigger modal) builds the documented
// fire URL; ROUTINE_CHAT_FIRE_URL, if set, overrides it verbatim.
export function chatRoutineConfig(): ChatRoutineConfig | null {
  const token = process.env.ROUTINE_CHAT_TOKEN?.trim()
  const id = process.env.ROUTINE_CHAT_ID?.trim()
  const fireUrl = process.env.ROUTINE_CHAT_FIRE_URL?.trim()
    || (id ? `https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(id)}/fire` : '')
  if (!token || !fireUrl) return null
  return { fireUrl, token }
}

export type FireResult = { ok: true; sessionUrl: string | null } | { ok: false; error: string }

// One API-trigger fire (code.claude.com/docs/en/routines, research preview —
// a 4xx usually means a newer dated beta header). Never throws.
export async function fireChatRoutine(text: string = CHAT_ROUTINE_FIRE_TEXT): Promise<FireResult> {
  const config = chatRoutineConfig()
  if (!config) return { ok: false, error: 'chat routine not configured (ROUTINE_CHAT_ID / ROUTINE_CHAT_TOKEN)' }
  try {
    const res = await fetch(config.fireUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'anthropic-beta': FIRE_BETA,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
    })
    const body = await res.text().catch(() => '')
    if (!res.ok) return { ok: false, error: `fire failed (${res.status}): ${body.slice(0, 300)}` }
    let sessionUrl: string | null = null
    try {
      const parsed = JSON.parse(body) as { claude_code_session_url?: unknown }
      if (typeof parsed.claude_code_session_url === 'string') sessionUrl = parsed.claude_code_session_url
    } catch { /* non-JSON body is still a successful fire */ }
    return { ok: true, sessionUrl }
  } catch (err) {
    return { ok: false, error: `fire failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export const chatJobKeyPrefix = (threadId: string) => `chat:${threadId}:`
export const chatJobKey = (threadId: string, userMessageId: string) => `${chatJobKeyPrefix(threadId)}${userMessageId}`

export async function listOpenChatJobs(userId: string, threadId: string): Promise<ThinkingJobRow[]> {
  const prefix = chatJobKeyPrefix(threadId)
  const [queued, claimed] = await Promise.all([
    listJobs(userId, { kind: CHAT_JOB_KIND, status: 'queued', limit: 50 }),
    listJobs(userId, { kind: CHAT_JOB_KIND, status: 'claimed', limit: 50 }),
  ])
  return [...queued, ...claimed].filter((j) => j.externalKey.startsWith(prefix))
}

// Does a chat job own this user message's reply? True while the job is open
// (queued / claimed), and — whatever its status — for the ownership window
// after it was created: a watchdog (or rejected-answer) paid fallback may
// still be running for it, and a second paid turn would double-reply. Used
// by sendChatMessage's orphan retry and the webhook's identical-resend path.
// Flag off → no lookup at all (today's behaviour). A lookup failure answers
// false — the guard never blocks a reply on its own.
export async function chatJobOwnsMessage(
  userId: string,
  threadId: string,
  messageId: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!chatRoutineEnabled()) return false
  try {
    const key = chatJobKey(threadId, messageId)
    const since = new Date(now.getTime() - CHAT_JOB_OWNERSHIP_WINDOW_MS)
    const [open, recent] = await Promise.all([
      listOpenChatJobs(userId, threadId),
      listJobs(userId, { kind: CHAT_JOB_KIND, since, limit: 50 }),
    ])
    return [...open, ...recent].some((j) => j.externalKey === key)
  } catch (err) {
    console.error('[kairos-chat-routine] chat job ownership lookup failed', {
      threadId,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// A newer operator message supersedes any open chat job on the thread: the
// new job's transcript carries the earlier message, so one reply answers
// both instead of two replies interleaving. Returns how many were closed.
export async function supersedeOpenChatJobs(userId: string, threadId: string, keepKey: string): Promise<number> {
  const open = await listOpenChatJobs(userId, threadId)
  let closed = 0
  for (const job of open) {
    if (job.externalKey === keepKey) continue
    const row = await failJob(userId, job.id, null, `${CHAT_SUPERSEDED_PREFIX} a newer operator message took over this turn`)
    if (row) closed++
  }
  return closed
}

export type ChatWatchdogOutcome =
  | { outcome: 'answered' }
  | { outcome: 'superseded' }
  | { outcome: 'swept' }
  | { outcome: 'missing' }
  | { outcome: 'owned_elsewhere' }
  | { outcome: 'fallback' }
  | { outcome: 'fallback_failed'; reason: string }

export type ChatFallback = (job: ThinkingJobRow) => Promise<ApplyOutcome>

async function runFallback(job: ThinkingJobRow, fallback: ChatFallback): Promise<ChatWatchdogOutcome> {
  try {
    const result = await fallback(job)
    return result.ok ? { outcome: 'fallback' } : { outcome: 'fallback_failed', reason: result.reason }
  } catch (err) {
    return { outcome: 'fallback_failed', reason: err instanceof Error ? err.message : String(err) }
  }
}

// Take an open job away from the routine (server-side fail, no token) and
// answer it on the paid key. Only the caller that wins the transition runs
// the fallback.
export async function takeOverChatJob(
  userId: string,
  jobId: string,
  reason: string,
  fallback: ChatFallback,
): Promise<ChatWatchdogOutcome> {
  const paidOn = await isPaidBackupEnabled(userId)
  const how = paidOn ? 'answered on the paid key' : PAID_BACKUP_OFF_NOTE
  const taken = await failJob(userId, jobId, null, `${CHAT_WATCHDOG_PREFIX} ${reason}; ${how}`)
  if (!taken) return { outcome: 'owned_elsewhere' }
  return runFallback(taken, fallback)
}

export interface ChatWatchdogOptions {
  timeoutMs?: number
  pollMs?: number
  graceMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  // Called between polls (the webhook re-sends Telegram's typing action).
  onPoll?: () => Promise<void> | void
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Poll the job until the routine answers or the timeout passes, then run the
// paid fallback — exactly once, and never for a job someone else closed.
export async function runChatWatchdog(
  userId: string,
  jobId: string,
  fallback: ChatFallback,
  opts: ChatWatchdogOptions = {},
): Promise<ChatWatchdogOutcome> {
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? defaultSleep
  const timeoutMs = Math.min(opts.timeoutMs ?? chatRoutineTimeoutMs(), MAX_CHAT_ROUTINE_TIMEOUT_MS)
  const pollMs = Math.min(opts.pollMs ?? chatRoutinePollMs(), MAX_CHAT_ROUTINE_POLL_MS)
  const graceMs = opts.graceMs ?? CHAT_CLAIMED_GRACE_MS
  const maxWaitMs = chatWatchdogMaxWaitMs(timeoutMs, graceMs, pollMs)
  const startedAt = now()
  let lostTakeovers = 0

  for (;;) {
    const job = await findJobById(userId, jobId)
    if (!job) return { outcome: 'missing' }

    if (job.status === 'done' || job.status === 'fallback') return { outcome: 'answered' }
    // Overdue and swept: the hourly sweep runs the chat fallback itself.
    if (job.status === 'expired') return { outcome: 'swept' }
    if (job.status === 'failed') {
      if (job.error?.startsWith(CHAT_SUPERSEDED_PREFIX)) return { outcome: 'superseded' }
      if (job.error?.startsWith(CHAT_WATCHDOG_PREFIX)) return { outcome: 'owned_elsewhere' }
      // The routine's answer was rejected or late — nothing else covers a
      // chat job, so answer it now.
      return runFallback(job, fallback)
    }

    const elapsed = now() - startedAt
    const due = job.status === 'claimed'
      ? now() >= job.deadlineAt.getTime() + graceMs
      : elapsed >= timeoutMs
    if (due || elapsed >= maxWaitMs) {
      const outcome = await takeOverChatJob(
        userId,
        jobId,
        job.status === 'claimed'
          ? 'routine claimed but did not submit before the deadline'
          : `routine did not claim within ${Math.round(timeoutMs / 1000)}s`,
        fallback,
      )
      if (outcome.outcome !== 'owned_elsewhere') return outcome
      // The job moved under us (answered or failed) — re-read it.
      if (++lostTakeovers >= 3) return outcome
      continue
    }

    try {
      await opts.onPoll?.()
    } catch { /* cosmetic */ }
    await sleep(pollMs)
  }
}

// ── Per-turn timing (stamped on the job's output.timing at settle) ────────

export type ChatSettleOutcome = ChatWatchdogOutcome['outcome'] | 'error'

export interface ChatTiming {
  channel: ChatChannel
  // null when the settle threw before the fire returned.
  fireOk: boolean | null
  fireMs: number | null
  outcome: ChatSettleOutcome
  enqueueToClaimMs: number | null
  claimToAnswerMs: number | null
  // Routine answers only (status done): completedAt − createdAt.
  enqueueToAnswerMs: number | null
  // Job creation → this settle finished (covers paid/fallback answers, whose
  // completedAt is the takeover, not the answer).
  enqueueToSettleMs: number
  // Operator message persisted → job queued (retrieval + prompt build).
  messageToEnqueueMs?: number
}

export interface RecordChatTimingInput {
  channel: ChatChannel
  fire: { ok: boolean; ms: number } | null
  outcome: ChatSettleOutcome
  settledAt: Date
  messageToEnqueueMs?: number | null
}

// Clock-skew guard: DB timestamps vs the server clock can disagree slightly.
const span = (from: Date | null | undefined, to: Date | null | undefined): number | null =>
  from && to ? Math.max(0, to.getTime() - from.getTime()) : null

// Best-effort: re-reads the job and merges output.timing. Never throws.
export async function recordChatTiming(userId: string, jobId: string, input: RecordChatTimingInput): Promise<ChatTiming | null> {
  try {
    const job = await findJobById(userId, jobId)
    if (!job) return null
    const done = job.status === 'done'
    const timing: ChatTiming = {
      channel: input.channel,
      fireOk: input.fire ? input.fire.ok : null,
      fireMs: input.fire ? Math.max(0, Math.round(input.fire.ms)) : null,
      outcome: input.outcome,
      enqueueToClaimMs: span(job.createdAt, job.claimedAt),
      claimToAnswerMs: done ? span(job.claimedAt, job.completedAt) : null,
      enqueueToAnswerMs: done ? span(job.createdAt, job.completedAt) : null,
      enqueueToSettleMs: span(job.createdAt, input.settledAt) ?? 0,
    }
    if (typeof input.messageToEnqueueMs === 'number' && Number.isFinite(input.messageToEnqueueMs)) {
      timing.messageToEnqueueMs = Math.max(0, Math.round(input.messageToEnqueueMs))
    }
    await mergeJobOutput(userId, jobId, { timing })
    return timing
  } catch (err) {
    console.error('[kairos-chat-routine] recording chat timing failed', {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export interface SettleChatJobOptions {
  channel: ChatChannel
  timeoutMs: number
  // Console prefix of the calling surface, e.g. 'telegram-webhook'.
  logTag: string
  // The chat handler's paid fallback (passed in: handlers/chat imports this module).
  fallback: ChatFallback
  messageToEnqueueMs?: number | null
  onPoll?: () => Promise<void> | void
}

// The after() body of both chat channels: fire the routine, watch the job
// (or take it over at once if the fire failed), then stamp the turn's
// timing. Never throws.
export async function settleChatJob(
  userId: string,
  jobId: string,
  opts: SettleChatJobOptions,
): Promise<ChatWatchdogOutcome | null> {
  const tag = `[${opts.logTag}]`
  let fire: RecordChatTimingInput['fire'] = null
  let outcome: ChatWatchdogOutcome | null = null
  try {
    const fireStart = Date.now()
    const fired = await fireChatRoutine()
    fire = { ok: fired.ok, ms: Date.now() - fireStart }
    if (!fired.ok) console.error(`${tag} chat routine fire failed — fallback`, fired.error)
    outcome = fired.ok
      ? await runChatWatchdog(userId, jobId, opts.fallback, { timeoutMs: opts.timeoutMs, onPoll: opts.onPoll })
      : await takeOverChatJob(userId, jobId, fired.error, opts.fallback)
    if (outcome.outcome === 'fallback_failed') {
      console.error(`${tag} chat fallback failed`, { jobId, reason: outcome.reason })
    } else {
      console.info(`${tag} chat turn settled`, { jobId, outcome: outcome.outcome })
    }
  } catch (err) {
    console.error(`${tag} chat routine watchdog failed`, err)
  }
  await recordChatTiming(userId, jobId, {
    channel: opts.channel,
    fire,
    outcome: outcome?.outcome ?? 'error',
    settledAt: new Date(),
    messageToEnqueueMs: opts.messageToEnqueueMs,
  })
  return outcome
}
