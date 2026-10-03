import { getConsciencePrinciples, listConscienceBeliefs } from '@/lib/data/conscience'
import { fetchMemoriesByIds } from '@/lib/data/dialogue'
import { listOpenGoals } from '@/lib/data/goals'
import { listKairosPromises } from '@/lib/data/kairos-promises'
import { hasJobWithKeyLike, listJobs } from '@/lib/data/thinking-jobs'
import { dreamsMode } from '@/lib/kairos/dreams/flag'
import { DREAM_KIND, readDreamOutput, type DreamJobOutput } from '@/lib/kairos/dreams/parse'
import { DREAM_READ_KIND, dreamReadJobKey, dreamReadThoughts } from '@/lib/kairos/dreams/read'
import { parseDreamReadText, type DreamReadOutput, type DreamReadResult } from '@/lib/kairos/dreams/read-parse'
import {
  buildDreamReadPrompt,
  DREAM_READ_MAX_BELIEFS,
  DREAM_READ_MAX_GOALS,
  DREAM_READ_MAX_OUTPUT_TOKENS,
  DREAM_READ_MAX_PRINCIPLES,
  DREAM_READ_MAX_PROMISES,
  DREAM_READ_SYSTEM_PROMPT,
  dreamReadContextSchema,
  type DreamReadContext,
  type DreamReadPromptInput,
} from '@/lib/kairos/dreams/read-prompt'
import type { ApplyOutcome, ThinkingAnsweredBy, ThinkingJobHandler, ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'
import { DREAM_READ_WINDOW_UTC, minutesLeftInWindow, utcDay } from '../deadlines'
import { withThoughts } from '../stage-thoughts'
import { errorReason } from './_errors'

// Morning read of tonight's dream (spec_dreams, lane C). plan: KAIROS_DREAMS
// on/observe, inside the window, tonight's dream job done, no read yet (key
// dream_read:<date>) — chained like idea_judge after idea_generate. apply:
// strict parse → aliases mapped to ids → job output only. Never writes a
// memory, never changes a belief, never books Horae; in mode 'on' it offers
// ≤2 speculative stage thoughts. No fallback: a missed night is fine.

async function findTonightsDream(userId: string, day: string): Promise<{ id: string; out: DreamJobOutput } | null> {
  const jobs = await listJobs(userId, { kind: DREAM_KIND, status: 'done', limit: 5 })
  for (const j of jobs) {
    const out = readDreamOutput(j.output)
    if (out && out.date === day) return { id: j.id, out }
  }
  return null
}

async function openPromises(userId: string) {
  try {
    const open = await listKairosPromises(userId, { scope: 'open' })
    return [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, DREAM_READ_MAX_PROMISES)
  } catch (err) {
    console.warn('[kairos:dream-read] promises unreadable:', errorReason(err))
    return []
  }
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (dreamsMode() === 'off') return []
  const deadlineMinutes = minutesLeftInWindow(now, DREAM_READ_WINDOW_UTC)
  if (deadlineMinutes <= 0) return []
  const date = utcDay(now)
  const externalKey = dreamReadJobKey(date)
  if (await hasJobWithKeyLike(userId, DREAM_READ_KIND, externalKey)) return []
  const dream = await findTonightsDream(userId, date)
  if (!dream) return []

  const sourceIds = [...new Set(dream.out.scenes.map((s) => s.memoryId))]
  const distortion = new Map(dream.out.scenes.map((s) => [s.memoryId, s.distortion]))
  const [rows, constitution, beliefs, goals, promises] = await Promise.all([
    fetchMemoriesByIds(userId, sourceIds),
    getConsciencePrinciples(userId),
    listConscienceBeliefs(userId, { limit: DREAM_READ_MAX_BELIEFS }),
    listOpenGoals(userId, now),
    openPromises(userId),
  ])

  const memories = rows.map((m, i) => ({ alias: `m${i + 1}`, id: m.id, distortion: distortion.get(m.id) ?? '', title: m.title, summary: m.body }))
  const principles = (constitution?.principles ?? []).slice(0, DREAM_READ_MAX_PRINCIPLES).map((p, i) => ({ alias: `p${i + 1}`, index: i, text: p.text }))
  // listConscienceBeliefs exposes no row id yet; the read keeps the claim.
  const heldBeliefs = beliefs.slice(0, DREAM_READ_MAX_BELIEFS).map((b, i) => ({
    alias: `b${i + 1}`,
    id: (b as { id?: string }).id ?? null,
    claim: b.claim,
    domain: b.domain,
  }))
  const activeGoals = goals.filter((g) => g.meta.state === 'active').slice(0, DREAM_READ_MAX_GOALS)
    .map((g, i) => ({ alias: `g${i + 1}`, id: g.id, title: g.title, question: g.meta.question }))
  const promiseRows = promises.map((p, i) => ({ alias: `P${i + 1}`, id: p.id, number: `P${p.seq}`, outcome: p.outcome, dueDate: p.dueDate }))

  const promptInput: DreamReadPromptInput = {
    date,
    dream: dream.out,
    memories,
    principles,
    beliefs: heldBeliefs,
    goals: activeGoals,
    promises: promiseRows,
  }
  const context: DreamReadContext = {
    date,
    dreamJobId: dream.id,
    memories: memories.map(({ alias, id, distortion: d }) => ({ alias, id, distortion: d })),
    principles: principles.map(({ alias, index }) => ({ alias, index })),
    beliefs: heldBeliefs.map(({ alias, id, claim }) => ({ alias, id, claim })),
    goals: activeGoals.map(({ alias, id, title }) => ({ alias, id, title })),
    promises: promiseRows.map(({ alias, id, outcome }) => ({ alias, id, title: outcome })),
  }
  return [{
    kind: DREAM_READ_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes,
    input: {
      system: DREAM_READ_SYSTEM_PROMPT,
      prompt: buildDreamReadPrompt(promptInput),
      validMemoryIds: [],
      maxOutputTokens: DREAM_READ_MAX_OUTPUT_TOKENS,
      context,
    },
  }]
}

function readContext(job: ThinkingJobRow): DreamReadContext | null {
  const parsed = dreamReadContextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

async function apply(job: ThinkingJobRow, text: string, _answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: dream_read job has no context' }
  const mode = dreamsMode()
  if (mode === 'off') return { ok: true, memoryIds: [], output: { skipped: 'dreams_off' } }

  let read: DreamReadResult
  try {
    read = parseDreamReadText(text, ctx)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  const output: DreamReadOutput = { dreamt: true, v: 1, date: ctx.date, dreamJobId: ctx.dreamJobId, ...read }
  const outcome: ApplyOutcome = { ok: true, memoryIds: [], output: { ...output } }
  return mode === 'on' ? withThoughts(outcome, dreamReadThoughts(output)) : outcome
}

export const dreamReadHandler: ThinkingJobHandler = {
  kind: DREAM_READ_KIND,
  plan,
  apply,
  fallback: async () => ({ ok: false, reason: 'no fallback — a missed night is fine' }),
}
