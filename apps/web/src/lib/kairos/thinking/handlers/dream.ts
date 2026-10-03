import { listOpenKairosAsks } from '@/lib/data/ask'
import { listDreamCandidates } from '@/lib/data/dream-inputs'
import { listOpenGoals } from '@/lib/data/goals'
import { listActiveDominions } from '@/lib/data/idea-inputs'
import { readKairosPredictions } from '@/lib/data/kairos-predictions'
import { readKairosPromises } from '@/lib/data/kairos-promises'
import { readKairosStage } from '@/lib/data/kairos-stage'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { assignDistortions } from '@/lib/kairos/dreams/distort'
import { dreamsMode } from '@/lib/kairos/dreams/flag'
import {
  buildDreamOutput,
  DREAM_KIND,
  dreamContextSchema,
  dreamJobKey,
  parseDreamText,
  type DreamJobContext,
} from '@/lib/kairos/dreams/parse'
import { DREAM_MIN_CANDIDATES, DREAM_MIN_PICKS, pickDreamMemories, pickSeeds, type DreamSeedItem } from '@/lib/kairos/dreams/pick'
import { buildDreamPrompt, DREAM_MAX_OUTPUT_TOKENS, DREAM_SYSTEM_PROMPT } from '@/lib/kairos/dreams/prompt'
import { embedOne } from '@/lib/kairos/embeddings'
import type { ApplyOutcome, ThinkingJobHandler, ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'
import { predictionsEnabled } from '@/lib/kairos/predictions/flag'
import { stageMode } from '@/lib/kairos/stage/flag'
import { activeFocus } from '@/lib/kairos/stage/select'
import { DREAM_WINDOW_UTC, minutesLeftInWindow, utcDay } from '../deadlines'
import { errorReason } from './_errors'

// Nightly dream (spec_dreams, KAIROS_DREAMS observe|1). plan: inside the dream
// window, once a UTC night (key dream:<date>), only with at least one open
// thread to circle and three candidate memories. apply: strict parse, then the
// dream lives ONLY in this job's output — no memory, trace or today-log row,
// memoryIds always []. No fallback: a missed night is fine.

async function settled<T>(label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (err) {
    console.warn(`[kairos:dream] reading ${label} failed:`, errorReason(err))
    return null
  }
}

const latest = (...isos: Array<string | undefined>): Date | null => {
  const times = isos.flatMap((s) => (s ? [new Date(s).getTime()] : [])).filter(Number.isFinite)
  return times.length ? new Date(Math.max(...times)) : null
}

export async function gatherDreamSeeds(userId: string, now: Date): Promise<DreamSeedItem[]> {
  const [stage, asks, promises, predictions, goals] = await Promise.all([
    stageMode() === 'on' ? settled('stage', () => readKairosStage(userId)) : null,
    settled('asks', () => listOpenKairosAsks(userId, now)),
    settled('promises', () => readKairosPromises(userId)),
    predictionsEnabled() ? settled('predictions', () => readKairosPredictions(userId)) : null,
    settled('goals', () => listOpenGoals(userId, now)),
  ])
  const items: DreamSeedItem[] = []
  const focus = stage ? activeFocus(stage, now) : null
  if (focus) items.push({ kind: 'focus', ref: focus.coalitionId, text: focus.text, touchedAt: latest(focus.since) })
  for (const a of asks ?? []) items.push({ kind: 'ask', ref: a.id, text: a.title, touchedAt: latest(a.kairosAsk.askedAt) })
  const promise = (promises?.open ?? []).filter((p) => p.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  if (promise) {
    items.push({
      kind: 'promise',
      ref: promise.id,
      text: `${promise.outcome} (due ${promise.dueDate})`,
      touchedAt: latest(promise.createdAt, ...promise.dueHistory.map((h) => h.changedAt)),
    })
  }
  const prediction = (predictions?.open ?? []).filter((p) => p.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  if (prediction) {
    items.push({ kind: 'prediction', ref: prediction.id, text: `${prediction.claim} (by ${prediction.dueDate})`, touchedAt: latest(prediction.createdAt) })
  }
  const goal = (goals ?? []).filter((g) => g.meta.state === 'active')[0]
  if (goal) {
    items.push({
      kind: 'goal',
      ref: goal.id,
      text: `${goal.title} — ${goal.meta.question}`,
      touchedAt: latest(goal.meta.proposedAt, ...goal.meta.history.map((h) => h.at)),
    })
  }
  return pickSeeds(items, now)
}

async function anchorVector(seeds: readonly DreamSeedItem[]): Promise<number[] | null> {
  try {
    return await embedOne(seeds.map((s) => s.text).join('\n'), 'query')
  } catch (err) {
    console.warn('[kairos:dream] anchor embed failed, using the newest reflection:', errorReason(err))
    return null
  }
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (dreamsMode() === 'off') return []
  const deadlineMinutes = minutesLeftInWindow(now, DREAM_WINDOW_UTC)
  if (deadlineMinutes <= 0) return []
  const date = utcDay(now)
  const externalKey = dreamJobKey(date)
  if (await hasJobWithKeyLike(userId, DREAM_KIND, externalKey)) return []

  const seeds = await gatherDreamSeeds(userId, now)
  if (seeds.length === 0) return []
  const candidates = await listDreamCandidates(userId, date)
  if (candidates.length < DREAM_MIN_CANDIDATES) return []

  const picks = pickDreamMemories(candidates, await anchorVector(seeds), now)
  if (picks.length < DREAM_MIN_PICKS) return []
  const distortions = assignDistortions(date, picks.length)
  const areaName = new Map((await listActiveDominions(userId)).map((d) => [d.id, d.name]))

  const memories = picks.map((p, i) => ({ alias: `m${i + 1}`, pick: p, distortion: distortions[i] }))
  const seedRows = seeds.map((s, i) => ({ alias: `s${i + 1}`, seed: s }))
  const context: DreamJobContext = {
    date,
    memories: memories.map((m) => ({
      alias: m.alias,
      id: m.pick.candidate.id,
      dominionId: m.pick.candidate.dominionId,
      bucket: m.pick.bucket,
      distortion: m.distortion,
    })),
    seeds: seedRows.map((s) => ({ alias: s.alias, kind: s.seed.kind, ref: s.seed.ref })),
  }

  return [{
    kind: DREAM_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes,
    input: {
      system: DREAM_SYSTEM_PROMPT,
      prompt: buildDreamPrompt({
        date,
        now,
        memories: memories.map((m) => ({
          alias: m.alias,
          area: (m.pick.candidate.dominionId && areaName.get(m.pick.candidate.dominionId)) || 'No area',
          createdAt: m.pick.candidate.createdAt,
          title: m.pick.candidate.title,
          summary: m.pick.candidate.summary,
          distortion: m.distortion,
        })),
        seeds: seedRows.map((s) => ({ alias: s.alias, kind: s.seed.kind, text: s.seed.text })),
      }),
      validMemoryIds: [],
      maxOutputTokens: DREAM_MAX_OUTPUT_TOKENS,
      context,
    },
  }]
}

async function apply(job: ThinkingJobRow, text: string): Promise<ApplyOutcome> {
  const parsedContext = dreamContextSchema.safeParse(job.input?.context)
  if (!parsedContext.success) return { ok: false, reason: 'bad_job: dream job has no context' }
  const ctx = parsedContext.data
  if (ctx.date !== utcDay(new Date())) return { ok: false, reason: `stale_job: planned for ${ctx.date}` }
  if (dreamsMode() === 'off') return { ok: true, memoryIds: [], output: { skipped: 'dreams_off' } }

  try {
    const model = parseDreamText(text, ctx)
    return { ok: true, memoryIds: [], output: buildDreamOutput(model, ctx, [job.input.system, job.input.prompt]) }
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
}

export const dreamHandler: ThinkingJobHandler = {
  kind: DREAM_KIND,
  plan,
  apply,
  fallback: async () => ({ ok: false, reason: 'no fallback — a missed night is fine' }),
}
