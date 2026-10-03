import { z } from 'zod'
import { and, isNull, ne } from 'drizzle-orm'
import { memories } from '@/lib/db/schema'
import { listOpenGoals } from '@/lib/data/goals'
import { readKairosPromises } from '@/lib/data/kairos-promises'
import { captureMemory, listRecentMemories } from '@/lib/data/memories'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import {
  REFLECT_MAX_OUTPUT_TOKENS,
  REFLECT_SYSTEM_PROMPT,
  buildReflectPrompt,
  parseReflectText,
  renderReflectBody,
  type ReflectOutput,
  type ReflectPromise,
} from '@/lib/kairos/cadence/reflect-prompt'
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
// edits. No speaking, no fallback — a missed hour is fine.

export const REFLECT_KIND: ThinkingJobKind = 'reflect'
const TODAY_PROMPT_CHARS = 8000
const EVENTS_LIMIT = 15
const MAX_LINKS = 20

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

  const [digest, events, promises] = await Promise.all([
    loadTodayDigest(userId, { hours: 16, limit: 120 }),
    listRecentMemories(userId, [and(ne(memories.streamClass, 'agentic'), isNull(memories.archivedAt))!], { start: since, end: now }, EVENTS_LIMIT),
    openPromises(userId),
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

// ── Wave 2 hooks (A2) — deliberately inert ──────────────────────────────
// TODO(wave 2): hand `out.predictions` (≤1 per reflect) to the predictions
// lane's server-side creator, grounded to job.input.validMemoryIds.
export async function persistReflectPredictions(_job: ThinkingJobRow, _out: ReflectOutput): Promise<null> {
  return null
}

// TODO(wave 2): hand `out.followUps` to the agenda lane's creator (source
// kind 'reflect'); its caps and policy decide what is booked.
export async function persistReflectFollowUps(_job: ThinkingJobRow, _out: ReflectOutput): Promise<null> {
  return null
}

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
  const wave2 = { followUps: out.followUps.length, predictions: out.predictions.length }
  if (!out.thought) return { ok: true, memoryIds: [], output: { skipped: 'no_thought', dropped: out.dropped, wave2, answeredBy } }

  const goalTitles = new Map(ctx.goals.map((g) => [g.id, g.title]))
  const links = [...new Set([...out.goalNotes.map((g) => g.goalId), ...out.evidenceIds])].slice(0, MAX_LINKS)
  const { memory } = await captureMemory(job.userId, {
    title: `Reflection · ${ctx.slot.slice(REFLECT_KIND.length + 1).replace(/:(\d{2})$/, ' $1:00')}`,
    bodyMd: renderReflectBody(out, goalTitles),
    summary: out.thought.slice(0, 1000),
    type: 'observation',
    source: 'cron',
    streamClass: 'agentic',
    dominionId: null,
    links: links.map(refersTo),
    tags: ['reflection'],
    sourceMetadata: {
      kind: 'reflection',
      externalId: ctx.slot,
      jobId: job.id,
      answeredBy,
      goalNotes: out.goalNotes,
      evidenceIds: out.evidenceIds,
      dropped: out.dropped,
    },
  })

  await persistReflectPredictions(job, out)
  await persistReflectFollowUps(job, out)
  return { ok: true, memoryIds: [memory.id], output: { goalNotes: out.goalNotes.length, dropped: out.dropped, wave2, answeredBy } }
}

export const reflectHandler: ThinkingJobHandler = {
  kind: REFLECT_KIND,
  plan,
  apply,
  fallback: async () => ({ ok: false, reason: 'no fallback — a missed hour is fine' }),
}
