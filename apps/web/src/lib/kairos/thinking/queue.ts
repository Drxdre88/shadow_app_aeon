import {
  claimNextJob,
  completeJob,
  expireOverdue,
  failJob,
  findJobById,
  hasJobWithKeyLike,
  listJobs,
  listPendingFallbacks,
  recordFallback,
  releaseForFallback,
  upsertJob,
} from '@/lib/data/thinking-jobs'
import type {
  ThinkingJobHandler,
  ThinkingJobKind,
  ThinkingJobRow,
  ThinkingJobStatus,
} from '@/lib/kairos/engine/types'
import { conceptWeekKeyPattern, isConceptDay, isoWeekKey } from './deadlines'
import { getThinkingHandlers } from './registry'
import { isPaidBackupEnabled, PAID_BACKUP_OFF_NOTE } from '@/lib/kairos/paid-backup'
import {
  getRoutine,
  routineAllows,
  routineClaimant,
  routineFromClaimant,
  type RoutineId,
} from '@/lib/kairos/routines/catalog'

// ─────────────────────────────────────────────────────────────────────────
// Thinking queue (docs/kairos/32 §3, routine playbook docs/kairos/33).
//
// A Claude Max routine claims jobs through MCP/REST, thinks, and submits raw
// text; the server validates, grounds, mints ids and persists through the
// kind's handler. The server never calls Claude with plan credentials.
//
// Planning runs each handler's plan() (idempotent via unique(user_id,
// external_key)), in prerequisite order, from TWO places:
//   - every non-chat claim, so one routine run drains the night in order —
//     cortex once today's archetypes exist, then aether once the cortex work
//     is settled;
//   - the hourly thinking-sweep (SWEEP_PLAN_SKIP_KINDS excluded), so kinds
//     whose window opens after the nightly routine has finished (weekly
//     review, mind compare, daily message, a late drift probe) are still
//     created on schedule — then claimed by a routine or, past their
//     deadline, run by the sweep's paid-key fallback.
// ─────────────────────────────────────────────────────────────────────────

// Every kind the queue plans, in prerequisite order: a later kind may depend
// on jobs an earlier kind just planned in the same pass (aether waits on open
// cortex jobs). Chat is never planned (a web or Telegram message creates it). Must
// match the routine catalog's BRAIN_JOBS (minus chat) — a test enforces it, so
// a kind cannot be added without a routine to answer it.
export const PLANNED_THINKING_KINDS: readonly ThinkingJobKind[] = [
  // Archetypes wait on tonight's chat distill; cortex waits on archetypes.
  'chat_distill', 'archetype',
  'cortex', 'concept', 'aether',
  'belief_extract', 'drift_probe', 'mind_compare', 'constitution_seed', 'weekly_review',
  // Idea tournament after aether (its tensions feed generation); judge after
  // generate. Both before the daily message, which shows the idea of the day.
  'idea_generate', 'idea_judge',
  // Kairos's own goal, after the judge (accepted ideas seed it).
  'goal_propose',
  'ask_mine',
  // Last: the daily message reads what the night produced.
  'daily_message',
  // Horae (flagged): due agenda items, planned by claims AND the sweep (an
  // 8-hour deadline, so the night run still covers a missed daytime one).
  'agenda_due',
  // Daytime cadence (flagged): planned only on claims, never by the sweep.
  'reflect', 'pulse',
]

const PLAN_ORDER: readonly ThinkingJobKind[] = [...PLANNED_THINKING_KINDS, 'chat']

// Kinds whose handler.fallback does real work (a paid heavy-tier model call),
// run by the hourly sweep. Every other kind's fallback is its own cron, so the
// sweep only expires it. A late or rejected routine answer for one of these
// kinds releases the job to the sweep instead of failing it.
export const SWEEP_FALLBACK_KINDS: readonly ThinkingJobKind[] = [
  'concept', 'belief_extract', 'drift_probe', 'mind_compare', 'weekly_review',
  'idea_generate', 'idea_judge',
]

// Who covers a job the routine did not complete — used in error texts.
// Partial: a retired kind's leftover row gets the generic text.
const FALLBACK_OWNER: Partial<Record<ThinkingJobKind, string>> = {
  cortex: 'the 03:00 UTC cortex-regen cron',
  aether: 'the 03:15 UTC aether-regen cron',
  concept: 'the hourly thinking-sweep API fallback',
  belief_extract: 'the hourly thinking-sweep API fallback',
  drift_probe: 'the hourly thinking-sweep API fallback',
  mind_compare: 'the hourly thinking-sweep API fallback',
  weekly_review: 'the hourly thinking-sweep API fallback',
  daily_message: 'the 06:00 Europe/London daily-message cron',
  chat: 'the chat watchdog paid-key reply (web or Telegram)',
  idea_generate: 'the hourly thinking-sweep API fallback',
  idea_judge: 'the hourly thinking-sweep API fallback',
  chat_distill: 'the 02:00 UTC chat-distill cron',
  archetype: 'the 02:30 UTC archetype-synthesis cron',
  ask_mine: 'the 04:30 UTC ask-mine cron',
  constitution_seed: 'the Monday 05:58 UTC constitution-seed cron',
  goal_propose: 'nothing — a missed night proposes no goal',
  reflect: 'nothing — a missed hour is fine',
  pulse: 'nothing — a missed hour is fine',
  agenda_due: 'nothing — the item is marked missed',
}

function fallbackOwner(kind: ThinkingJobKind): string {
  return FALLBACK_OWNER[kind] ?? 'nothing (this kind is retired)'
}

// Kinds the hourly sweep never plans: concept clustering is heavy and is
// enqueued by the nightly engine (and claims); chat jobs come only from a
// web or Telegram chat message; the daytime pulse and reflection are planned
// only by their routine's claim (a sweep-planned slot would just expire).
export const SWEEP_PLAN_SKIP_KINDS: readonly ThinkingJobKind[] = ['concept', 'chat', 'pulse', 'reflect']

export function sweepOwnsFallback(kind: ThinkingJobKind): boolean {
  return SWEEP_FALLBACK_KINDS.includes(kind)
}

// Model work bound per sweep INVOCATION (shared across users): at most
// `maxFallbacks` fallbacks, and none started after `budgetMs` of wall clock —
// the rest stay pending for the next hourly sweep. The route has 300s.
export const DEFAULT_SWEEP_MAX_FALLBACKS = 2
export const DEFAULT_SWEEP_BUDGET_MS = 200_000

export interface SweepBudget {
  // true → a fallback may start now (and is counted); false → defer it.
  tryStart(): boolean
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

export function createSweepBudget(opts: {
  maxFallbacks?: number
  budgetMs?: number
  clock?: () => number
} = {}): SweepBudget {
  const maxFallbacks = opts.maxFallbacks ?? envInt('KAIROS_SWEEP_MAX_FALLBACKS', DEFAULT_SWEEP_MAX_FALLBACKS)
  const budgetMs = opts.budgetMs ?? envInt('KAIROS_SWEEP_BUDGET_MS', DEFAULT_SWEEP_BUDGET_MS)
  const clock = opts.clock ?? Date.now
  const startedAt = clock()
  let started = 0
  return {
    tryStart() {
      if (started >= maxFallbacks || clock() - startedAt >= budgetMs) return false
      started++
      return true
    },
  }
}

export const THINKING_JOB_INSTRUCTIONS = [
  'Treat `system` as your system prompt and `prompt` as the user message, and answer exactly as that system prompt demands.',
  'Reply with ONLY the JSON object it asks for (a single ```json fenced block is fine) — no commentary, no tool calls, no memory writes.',
  'Cite only ids listed in `validMemoryIds`, copied verbatim; the server drops anything else and mints all stored ids.',
  'Submit the raw answer text with submit_thinking_job { jobId, claimToken, text } before `deadlineAt`. Submissions are parsed strictly — there is no repair round-trip.',
].join('\n')

export const CHAT_JOB_INSTRUCTIONS = [
  'Treat `system` as your system prompt and `prompt` as the conversation so far, and write Kairos\'s next Telegram reply exactly as that system prompt demands.',
  'Reply with the plain message text only — no JSON, no tool calls, no memory writes.',
  'Submit it with submit_thinking_job { jobId, claimToken, text } before `deadlineAt`.',
].join('\n')

export function jobInstructions(kind: ThinkingJobKind): string {
  return kind === 'chat' ? CHAT_JOB_INSTRUCTIONS : THINKING_JOB_INSTRUCTIONS
}

export type SubmitErrorCode = 'not_found' | 'not_claimed' | 'bad_token' | 'deadline_passed' | 'apply_failed' | 'scope_denied'

export type SubmitResult =
  | { ok: true; jobId: string; kind: ThinkingJobKind; memoryIds: string[] }
  | { ok: false; code: SubmitErrorCode; error: string; jobId: string; kind?: ThinkingJobKind }

export interface PlanResult {
  planned: ThinkingJobRow[]
  errors: Array<{ kind: ThinkingJobKind; error: string }>
}

export interface SweepResult {
  expired: number
  fallbacks: Array<{ jobId: string; kind: ThinkingJobKind; ok: boolean; reason?: string }>
  // Pending fallbacks left for the next sweep by the budget.
  deferred: number
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export class ThinkingQueue {
  private readonly handlers: ThinkingJobHandler[]

  constructor(handlers: ThinkingJobHandler[] = getThinkingHandlers()) {
    const rank = (k: ThinkingJobKind) => {
      const i = PLAN_ORDER.indexOf(k)
      return i === -1 ? PLAN_ORDER.length : i
    }
    this.handlers = [...handlers].sort((a, b) => rank(a.kind) - rank(b.kind))
  }

  handlerFor(kind: ThinkingJobKind): ThinkingJobHandler | undefined {
    return this.handlers.find((h) => h.kind === kind)
  }

  // One failing handler never blocks the others (or the claim).
  // Concept planning clusters up to 600 embeddings per Dominion, so on claim
  // it runs at most once per user per ISO week: once any concept job with
  // this week's key exists (nightly engine or an earlier claim), skip it.
  async planDue(
    userId: string,
    now: Date = new Date(),
    opts: { skipKinds?: readonly ThinkingJobKind[]; onlyKinds?: readonly ThinkingJobKind[] } = {},
  ): Promise<PlanResult> {
    const result: PlanResult = { planned: [], errors: [] }
    for (const handler of this.handlers) {
      if (opts.skipKinds?.includes(handler.kind)) continue
      if (opts.onlyKinds && !opts.onlyKinds.includes(handler.kind)) continue
      try {
        if (handler.kind === 'concept') {
          if (!isConceptDay(now)) continue
          if (await hasJobWithKeyLike(userId, 'concept', conceptWeekKeyPattern(isoWeekKey(now)))) continue
        }
        const specs = await handler.plan(userId, now)
        for (const spec of specs) {
          const row = await upsertJob(userId, spec, now)
          if (row) result.planned.push(row)
        }
      } catch (err) {
        console.error(`[kairos:thinking] plan failed for ${handler.kind}:`, err)
        result.errors.push({ kind: handler.kind, error: message(err) })
      }
    }
    return result
  }

  async claim(
    userId: string,
    kinds?: readonly ThinkingJobKind[],
    now: Date = new Date(),
    routine?: RoutineId,
  ): Promise<ThinkingJobRow | null> {
    // Chat jobs are created by web/Telegram chat messages, never planned — a
    // chat-only claim must not pay for planning the nightly kinds. Without
    // `kinds`, claimNextJob never returns a chat job (explicit-only kind).
    // A kinds-filtered claim plans only those kinds: each routine pays only for
    // its own planning and the hourly sweep still plans everything on schedule.
    const chatOnly = kinds !== undefined && kinds.length > 0 && kinds.every((k) => k === 'chat')
    if (!chatOnly) await this.planDue(userId, now, kinds && kinds.length > 0 ? { onlyKinds: kinds } : {})
    // A scoped claim records its routine so submit can hold it to its scope.
    return routine ? claimNextJob(userId, kinds, routineClaimant(routine)) : claimNextJob(userId, kinds)
  }

  async submit(
    userId: string,
    jobId: string,
    claimToken: string,
    text: string,
    now: Date = new Date(),
    routine?: RoutineId,
  ): Promise<SubmitResult> {
    const job = await findJobById(userId, jobId)
    if (!job) return { ok: false, code: 'not_found', error: 'Thinking job not found', jobId }
    const base = { jobId, kind: job.kind }
    if (job.status !== 'claimed') {
      return { ok: false, code: 'not_claimed', error: `Job is ${job.status}, not claimed${job.error ? ` (${job.error})` : ''}`, ...base }
    }
    if (job.claimToken !== claimToken) {
      return { ok: false, code: 'bad_token', error: 'claimToken does not match the current claim', ...base }
    }
    // Scope: never closes the job — the real claimant, the watchdog or the
    // sweep still owns it.
    const scope = routineFromClaimant(job.claimedBy)
    if (routine && scope === null && !routineAllows(routine, job.kind)) {
      return { ok: false, code: 'scope_denied', error: `routine '${routine}' may not answer ${job.kind} jobs`, ...base }
    }
    if (routine && scope !== null && routine !== scope) {
      return { ok: false, code: 'scope_denied', error: `routine '${routine}' did not claim this job (claimed ${scope ? `by routine '${scope}'` : 'unscoped'})`, ...base }
    }
    if (scope && !routineAllows(scope, job.kind)) {
      return { ok: false, code: 'scope_denied', error: `routine '${scope}' may not answer ${job.kind} jobs`, ...base }
    }
    if (job.deadlineAt.getTime() <= now.getTime()) {
      const error = `deadline_passed: deadline was ${job.deadlineAt.toISOString()}; ${fallbackOwner(job.kind)} owns this job now`
      await this.closeUnanswered(userId, job, claimToken, error)
      return { ok: false, code: 'deadline_passed', error, ...base }
    }

    const handler = this.handlerFor(job.kind)
    let outcome
    try {
      outcome = handler
        ? await handler.apply(job, text, 'routine')
        : { ok: false as const, reason: `no handler registered for kind '${job.kind}'` }
    } catch (err) {
      outcome = { ok: false as const, reason: `apply_error: ${message(err)}` }
    }

    if (!outcome.ok) {
      const error = `${outcome.reason}; ${fallbackOwner(job.kind)} covers this job`
      await this.closeUnanswered(userId, job, claimToken, error)
      return { ok: false, code: 'apply_failed', error, ...base }
    }
    await completeJob(userId, jobId, claimToken, {
      ...(outcome.output ?? {}),
      memoryIds: outcome.memoryIds,
      answeredBy: 'routine',
      chars: text.length,
    }, 'routine')
    return { ok: true, jobId, kind: job.kind, memoryIds: outcome.memoryIds }
  }

  // A claimed job the routine did not complete (late or rejected answer):
  // sweep-fallback kinds are released to the sweep ('expired', pending its
  // fallback); cron-fallback kinds are failed — their cron covers them.
  private async closeUnanswered(userId: string, job: ThinkingJobRow, claimToken: string, error: string): Promise<void> {
    if (sweepOwnsFallback(job.kind)) await releaseForFallback(userId, job.id, claimToken, error)
    else await failJob(userId, job.id, claimToken, error)
  }

  // Expire overdue queued/claimed jobs. Cron-fallback kinds (aether/cortex)
  // get their declining fallback recorded (cheap, no model) and stay
  // 'expired'. SWEEP_FALLBACK_KINDS are run from the pending list —
  // this sweep's expiries plus earlier releases/deferrals — bounded by the
  // per-invocation budget; the rest wait for the next hourly sweep.
  async sweep(userId: string, now: Date = new Date(), budget: SweepBudget = createSweepBudget()): Promise<SweepResult> {
    const expired = await expireOverdue(now, userId)
    const fallbacks: SweepResult['fallbacks'] = []
    // The sweep gave up on a job: let its handler settle what it leaves behind.
    const abandon = async (job: ThinkingJobRow, handler: ThinkingJobHandler, reason: string) => {
      if (!handler.abandon) return
      try {
        await handler.abandon(job, reason)
      } catch (err) {
        console.error(`[kairos:thinking] abandon failed for ${job.kind} ${job.id}:`, err)
      }
    }
    const run = async (job: ThinkingJobRow, handler: ThinkingJobHandler) => {
      let outcome
      try {
        outcome = await handler.fallback(job)
      } catch (err) {
        outcome = { ok: false as const, reason: `fallback_error: ${message(err)}` }
      }
      const recorded = await recordFallback(userId, job.id, outcome, now)
      if (!outcome.ok && recorded) await abandon(job, handler, outcome.reason)
      fallbacks.push(outcome.ok
        ? { jobId: job.id, kind: job.kind, ok: true }
        : { jobId: job.id, kind: job.kind, ok: false, reason: outcome.reason })
    }

    for (const job of expired) {
      if (sweepOwnsFallback(job.kind)) continue
      const handler = this.handlerFor(job.kind)
      if (handler) await run(job, handler)
    }

    let deferred = 0
    const pending = await listPendingFallbacks(userId, SWEEP_FALLBACK_KINDS)
    // Paid backup switched off: close each pending fallback with a clear note
    // instead of running it — no model call, no sweep budget spent.
    const paidAllowed = pending.length > 0 ? await isPaidBackupEnabled(userId) : true
    for (const job of pending) {
      const handler = this.handlerFor(job.kind)
      if (!handler) continue
      if (!paidAllowed) {
        const outcome = { ok: false as const, reason: PAID_BACKUP_OFF_NOTE }
        const recorded = await recordFallback(userId, job.id, outcome, now)
        if (recorded) await abandon(job, handler, outcome.reason)
        fallbacks.push({ jobId: job.id, kind: job.kind, ok: false, reason: outcome.reason })
        continue
      }
      if (!budget.tryStart()) {
        deferred++
        continue
      }
      await run(job, handler)
    }
    return { expired: expired.length, fallbacks, deferred }
  }
}

let defaultQueue: ThinkingQueue | null = null
function queue(): ThinkingQueue {
  defaultQueue ??= new ThinkingQueue()
  return defaultQueue
}

// ── Surface functions shared by MCP tools and REST routes (parity) ────────

export interface ClaimedJobView {
  id: string
  kind: ThinkingJobKind
  externalKey: string
  claimToken: string
  deadlineAt: string
  system: string
  prompt: string
  validMemoryIds: string[]
  instructions: string
}

export type ClaimThinkingJobResult =
  | { job: ClaimedJobView | null }
  | { job: null; code: 'scope_denied'; error: string }

// Set once both routines declare `routine` on claim (re-pasted prompts).
function routineScopeRequired(): boolean {
  return process.env.KAIROS_REQUIRE_ROUTINE_SCOPE === '1'
}

export async function claimThinkingJob(
  userId: string,
  input: { kinds?: ThinkingJobKind[]; routine?: RoutineId } = {},
): Promise<ClaimThinkingJobResult> {
  // An explicit but empty filter (every named kind retired) claims nothing.
  if (input.kinds && input.kinds.length === 0) return { job: null }
  let kinds: readonly ThinkingJobKind[] | undefined = input.kinds
  if (input.routine) {
    // Scoped: the routine's allow-list, narrowed by any kinds it asked for.
    const allowed = getRoutine(input.routine).allowedKinds
    const denied = (input.kinds ?? []).filter((k) => !allowed.includes(k))
    if (denied.length > 0) {
      return { job: null, code: 'scope_denied', error: `routine '${input.routine}' may not claim ${denied.join(', ')}` }
    }
    kinds = input.kinds ?? allowed
  } else if (routineScopeRequired()) {
    return { job: null, code: 'scope_denied', error: 'claims must declare routine ("brain", "chat" or "pulse")' }
  } else {
    // Unscoped (an older brain prompt): the brain's allow-list, so it never
    // takes the pulse routine's jobs.
    kinds = input.kinds ?? getRoutine('brain').allowedKinds
  }
  const job = await queue().claim(userId, kinds, undefined, input.routine)
  if (!job || !job.claimToken) return { job: null }
  return {
    job: {
      id: job.id,
      kind: job.kind,
      externalKey: job.externalKey,
      claimToken: job.claimToken,
      deadlineAt: job.deadlineAt.toISOString(),
      system: job.input.system,
      prompt: job.input.prompt,
      validMemoryIds: job.input.validMemoryIds ?? [],
      instructions: jobInstructions(job.kind),
    },
  }
}

export async function submitThinkingJob(
  userId: string,
  input: { jobId: string; claimToken: string; text: string; routine?: RoutineId },
): Promise<SubmitResult> {
  return queue().submit(userId, input.jobId, input.claimToken, input.text, undefined, input.routine)
}

export function toJobSummary(j: ThinkingJobRow) {
  return {
    id: j.id,
    kind: j.kind,
    dominionId: j.dominionId,
    externalKey: j.externalKey,
    status: j.status,
    claimedBy: j.claimedBy,
    attempts: j.attempts,
    deadlineAt: j.deadlineAt,
    claimedAt: j.claimedAt,
    completedAt: j.completedAt,
    error: j.error,
    output: j.output,
    createdAt: j.createdAt,
  }
}

export async function listThinkingJobs(
  userId: string,
  input: { status?: ThinkingJobStatus; limit?: number } = {},
): Promise<{ jobs: ReturnType<typeof toJobSummary>[] }> {
  const rows = await listJobs(userId, { status: input.status, limit: input.limit })
  return { jobs: rows.map(toJobSummary) }
}

// HTTP status for a failed submit — shared so MCP and REST agree.
export function submitErrorStatus(code: SubmitErrorCode): number {
  if (code === 'not_found') return 404
  if (code === 'apply_failed') return 422
  return 409
}
