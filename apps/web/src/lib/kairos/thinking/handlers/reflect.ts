import { z } from 'zod'
import { and, isNull, ne, sql } from 'drizzle-orm'
import { memories } from '@/lib/db/schema'
import { listOpenGoals } from '@/lib/data/goals'
import { readKairosAgenda } from '@/lib/data/kairos-agenda'
import { readKairosPredictions } from '@/lib/data/kairos-predictions'
import { readKairosPromises } from '@/lib/data/kairos-promises'
import { captureMemory, listRecentMemories } from '@/lib/data/memories'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { createAgendaItems, type CreateAgendaResult } from '@/lib/kairos/agenda/create'
import { agendaEnabled } from '@/lib/kairos/agenda/flag'
import { AGENDA_MAX_LEAD_DAYS, formatAgendaWhen } from '@/lib/kairos/agenda/rules'
import {
  REFLECT_MAX_OUTPUT_TOKENS,
  REFLECT_SYSTEM_PROMPT,
  buildReflectPrompt,
  parseReflectText,
  renderReflectBody,
  type ReflectAgendaPrompt,
  type ReflectOutput,
  type ReflectPredictionPrompt,
  type ReflectPromise,
} from '@/lib/kairos/cadence/reflect-prompt'
import { londonDate } from '@/lib/kairos/daily-message-prompt'
import { characterCheckEnabled } from '@/lib/kairos/character/flag'
import { checkTone } from '@/lib/kairos/character/tone'
import { createKairosPredictions, type CreatePredictionsResult } from '@/lib/kairos/predictions/create'
import { predictionsEnabled } from '@/lib/kairos/predictions/flag'
import { renderTrackRecordBlock } from '@/lib/kairos/predictions/prompt-block'
import { scorePredictions } from '@/lib/kairos/predictions/score'
import { addDays, dueWindow } from '@/lib/kairos/promises/rules'
import {
  daytimeThinkingEnabled,
  hasOwnerActivitySince,
  lastLookedAt,
  listDaytimeJobsToday,
  reflectMaxPerDay,
} from '@/lib/kairos/cadence/signal'
import { loadTodayDigest } from '@/lib/kairos/today'
import { renderTodaySection } from '@/lib/kairos/today-render'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobKind,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { REFLECT_DEADLINE_MINUTES, REFLECT_WINDOW_LONDON, daytimeSlotKey, inLondonHours, londonClockLabel } from '../deadlines'
import { errorReason } from './_errors'

// Reflect (spec A, deep tier, brain routine). plan: nothing unless
// KAIROS_DAYTIME_THINKING=1, inside 08–21 London, one job per London hour,
// fewer than KAIROS_REFLECT_MAX_PER_DAY (6) finished today, and either new
// owner activity since the last reflection or an active goal not yet put in
// front of a finished reflection today. apply: at most one agentic
// `observation` memory (tag 'reflection'); goal notes become links, never goal
// edits. No speaking, no fallback — a missed hour is fine. With their own
// switches on, the answer may also carry ≤1 dated prediction (KAIROS_PREDICTIONS)
// and ≤2 Horae follow-ups (initiative + KAIROS_AGENDA); both go through the
// lanes' server-side creators, grounded to this job's ids, and never cost the
// reflection.

export const REFLECT_KIND: ThinkingJobKind = 'reflect'
const TODAY_PROMPT_CHARS = 8000
const EVENTS_LIMIT = 15
const MAX_LINKS = 20
// A quarantined (tone-flagged, 'trace') reflection is not new evidence for
// the next one — that loop is what the quarantine breaks.
const notToneFlagged = sql`not (${memories.tags} @> '["tone_flag"]'::jsonb)`

const contextSchema = z.object({
  slot: z.string().min(1),
  goals: z.array(z.object({ id: z.string().min(1), title: z.string() })),
  eventIds: z.array(z.string()),
})
type ReflectContext = z.infer<typeof contextSchema>

function readContext(job: ThinkingJobRow): ReflectContext | null {
  const parsed = contextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

// Goals already put in front of a finished reflection today.
function goalsReflectedOn(done: readonly ThinkingJobRow[]): Set<string> {
  const ids = new Set<string>()
  for (const j of done) for (const g of readContext(j)?.goals ?? []) ids.add(g.id)
  return ids
}

async function openPromises(userId: string): Promise<ReflectPromise[]> {
  try {
    const state = await readKairosPromises(userId)
    return state.open.map((p) => ({ seq: p.seq, outcome: p.outcome, dueDate: p.dueDate }))
  } catch (err) {
    console.warn('[kairos:reflect] promise read failed — reflecting without them:', errorReason(err))
    return []
  }
}

// KAIROS_PREDICTIONS only: the track-record note, the due window and the
// open claims (so the model doesn't repeat one). A read failure drops the
// section rather than the reflection.
async function predictionPrompt(userId: string, now: Date): Promise<ReflectPredictionPrompt | undefined> {
  if (!predictionsEnabled()) return undefined
  try {
    const state = await readKairosPredictions(userId)
    return {
      ...dueWindow(now),
      trackRecordBlock: renderTrackRecordBlock(scorePredictions(state.closed, now)),
      open: state.open.map((p) => ({ seq: p.seq, claim: p.claim, dueDate: p.dueDate, probability: p.probability })),
    }
  } catch (err) {
    console.warn('[kairos:reflect] prediction read failed — no prediction this hour:', errorReason(err))
    return undefined
  }
}

// Horae only: open check-ins and the booking window (today .. 13 days out in
// London dates, inside the creator's 1 hour–14 day lead).
async function agendaPrompt(userId: string, now: Date): Promise<ReflectAgendaPrompt | undefined> {
  if (!agendaEnabled()) return undefined
  try {
    const state = await readKairosAgenda(userId)
    const today = londonDate(now)
    return {
      earliest: today,
      latest: addDays(today, AGENDA_MAX_LEAD_DAYS - 1),
      open: state.open.map((i) => ({ seq: i.seq, what: i.what, when: formatAgendaWhen(i.dueAt) })),
    }
  } catch (err) {
    console.warn('[kairos:reflect] agenda read failed — no follow-ups this hour:', errorReason(err))
    return undefined
  }
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (!daytimeThinkingEnabled()) return []
  if (!inLondonHours(now, REFLECT_WINDOW_LONDON)) return []
  const externalKey = daytimeSlotKey(REFLECT_KIND, now)
  if (await hasJobWithKeyLike(userId, REFLECT_KIND, externalKey)) return []

  const today = await listDaytimeJobsToday(userId, REFLECT_KIND, now)
  const done = today.filter((j) => j.status === 'done')
  if (done.length >= reflectMaxPerDay()) return []
  const since = lastLookedAt(today, now)

  const goals = (await listOpenGoals(userId, now)).filter((g) => g.meta.state === 'active')
  const reflected = goalsReflectedOn(done)
  const goalPending = goals.some((g) => !reflected.has(g.id))
  if (!goalPending && !(await hasOwnerActivitySince(userId, since, now))) return []

  const [digest, events, promises, predictions, agenda] = await Promise.all([
    loadTodayDigest(userId, { hours: 16, limit: 120 }),
    listRecentMemories(userId, [and(ne(memories.streamClass, 'agentic'), isNull(memories.archivedAt), notToneFlagged)!], { start: since, end: now }, EVENTS_LIMIT),
    openPromises(userId),
    predictionPrompt(userId, now),
    agendaPrompt(userId, now),
  ])
  const todaySection = renderTodaySection(digest, { maxChars: TODAY_PROMPT_CHARS, heading: 'Today so far' })
  if (!todaySection && events.length === 0 && goals.length === 0) return []

  return [{
    kind: REFLECT_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes: REFLECT_DEADLINE_MINUTES,
    input: {
      system: REFLECT_SYSTEM_PROMPT,
      prompt: buildReflectPrompt({
        londonTime: londonClockLabel(now),
        since: `${londonClockLabel(since)} London`,
        todaySection,
        events: events.map((e) => ({ id: e.id, title: e.title, at: londonClockLabel(e.createdAt) })),
        goals: goals.map((g) => ({ id: g.id, title: g.title, question: g.meta.question, dueAt: g.meta.dueAt })),
        promises,
        reflectionsToday: done.length,
        ...(predictions ? { predictions } : {}),
        ...(agenda ? { agenda } : {}),
      }),
      validMemoryIds: [...events.map((e) => e.id), ...goals.map((g) => g.id)],
      maxOutputTokens: REFLECT_MAX_OUTPUT_TOKENS,
      context: {
        slot: externalKey,
        goals: goals.map((g) => ({ id: g.id, title: g.title })),
        eventIds: events.map((e) => e.id),
      } satisfies ReflectContext,
    },
  }]
}

// KAIROS_PREDICTIONS only: at most one prediction (the creator's per-source
// cap for 'reflect'), grounded to this job's fed ids. Never costs the reflection.
export async function persistReflectPredictions(job: ThinkingJobRow, out: ReflectOutput): Promise<CreatePredictionsResult | null> {
  if (!predictionsEnabled() || out.predictions.length === 0) return null
  try {
    return await createKairosPredictions(
      job.userId,
      out.predictions,
      { kind: 'reflect', jobId: job.id },
      { validMemoryIds: job.input.validMemoryIds ?? [] },
    )
  } catch (err) {
    console.warn('[kairos:reflect] predictions not created:', errorReason(err))
    return null
  }
}

// Only the fields the agenda proposal accepts; a goalId must name a goal
// this reflection was shown (else it is dropped, not the follow-up).
function cleanFollowUp(raw: unknown, goalIds: ReadonlySet<string>): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const r = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of ['what', 'date', 'slot', 'basisIds'] as const) if (r[k] !== null && r[k] !== undefined) out[k] = r[k]
  if (typeof r.goalId === 'string' && goalIds.has(r.goalId)) out.goalId = r.goalId
  return out
}

// Horae only: at most two follow-ups (the creator's per-job cap), basis
// grounded to this job's fed ids. Never costs the reflection.
export async function persistReflectFollowUps(job: ThinkingJobRow, out: ReflectOutput, goalIds: ReadonlySet<string> = new Set()): Promise<CreateAgendaResult | null> {
  if (!agendaEnabled() || out.followUps.length === 0) return null
  try {
    return await createAgendaItems(
      job.userId,
      out.followUps.map((f) => cleanFollowUp(f, goalIds)),
      { kind: 'reflect', jobId: job.id },
      { validBasisIds: new Set(job.input.validMemoryIds ?? []) },
    )
  } catch (err) {
    console.warn('[kairos:reflect] follow-ups not booked:', errorReason(err))
    return null
  }
}

const createdSeqs = (prefix: string, items: ReadonlyArray<{ seq: number }>) => items.map((i) => `${prefix}${i.seq}`)
const rejectReasons = (r: ReadonlyArray<{ reason: string }>) => r.map((x) => x.reason)

const refersTo = (target: string) => ({ type: 'refers_to' as const, target, target_kind: 'memory' as const })

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: reflect job has no context' }
  if (!daytimeThinkingEnabled()) return { ok: true, memoryIds: [], output: { skipped: 'daytime_off', answeredBy } }

  const goalIds = new Set(ctx.goals.map((g) => g.id))
  let out: ReflectOutput
  try {
    out = parseReflectText(text, new Set([...ctx.eventIds, ...goalIds]), goalIds)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  const proposed = { followUps: out.followUps.length, predictions: out.predictions.length }
  if (!out.thought) return { ok: true, memoryIds: [], output: { skipped: 'no_thought', dropped: out.dropped, proposed, answeredBy } }

  const goalTitles = new Map(ctx.goals.map((g) => [g.id, g.title]))
  const links = [...new Set([...out.goalNotes.map((g) => g.goalId), ...out.evidenceIds])].slice(0, MAX_LINKS)
  // Tone budget (character check): flagged text is tagged and, with the
  // check switched on, filed as 'trace' — kept for audit, out of retrieval.
  const tone = checkTone(out.thought)
  const quarantined = tone.flagged && characterCheckEnabled()
  const { memory } = await captureMemory(job.userId, {
    title: `Reflection · ${ctx.slot.slice(REFLECT_KIND.length + 1).replace(/:(\d{2})$/, ' $1:00')}`,
    bodyMd: renderReflectBody(out, goalTitles),
    summary: out.thought.slice(0, 1000),
    type: 'observation',
    source: 'cron',
    streamClass: quarantined ? 'trace' : 'agentic',
    dominionId: null,
    links: links.map(refersTo),
    tags: tone.flagged ? ['reflection', 'tone_flag'] : ['reflection'],
    sourceMetadata: {
      kind: 'reflection',
      externalId: ctx.slot,
      jobId: job.id,
      answeredBy,
      goalNotes: out.goalNotes,
      evidenceIds: out.evidenceIds,
      dropped: out.dropped,
      tone: { score: tone.score, markers: tone.markers, flagged: tone.flagged },
    },
  })

  const predicted = await persistReflectPredictions(job, out)
  const booked = await persistReflectFollowUps(job, out, goalIds)
  return {
    ok: true,
    memoryIds: [memory.id],
    output: {
      goalNotes: out.goalNotes.length,
      dropped: out.dropped,
      proposed,
      ...(predicted ? { predictions: { created: createdSeqs('R', predicted.created), rejected: rejectReasons(predicted.rejected) } } : {}),
      ...(booked ? { followUps: { created: createdSeqs('A', booked.created), rejected: rejectReasons(booked.rejected) } } : {}),
      answeredBy,
    },
  }
}

export const reflectHandler: ThinkingJobHandler = {
  kind: REFLECT_KIND,
  plan,
  apply,
  fallback: async () => ({ ok: false, reason: 'no fallback — a missed hour is fine' }),
}
