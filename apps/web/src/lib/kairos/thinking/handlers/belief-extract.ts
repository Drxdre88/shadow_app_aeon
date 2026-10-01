import { z } from 'zod'
import { findDominionsByUser } from '@/lib/data/dominions'
import {
  listHeldBeliefs,
  listOperatorSignals,
  listRecentExtractJobs,
  SIGNAL_INPUT_CAP,
  thinkingJobKeyExists,
  writeAlignedBeliefs,
  type AlignedCreate,
  type AlignedReinforce,
  type ExtractJobState,
} from '@/lib/data/beliefs'
import { FALLBACK_ERROR_PREFIX } from '@/lib/data/thinking-jobs'
import {
  EXTRACT_SYSTEM_PROMPT,
  buildExtractPrompt,
  parseExtractText,
  type GroundedClaim,
} from '@/lib/kairos/beliefs/extract-prompt'
import { askPaidAndParse } from '../paid-fallback'
import { beliefRowValues, type BeliefV1 } from '@/lib/kairos/beliefs/types'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { deadlineOn, utcDay } from '../deadlines'
import { errorReason } from './_errors'

// Aligned-mind extraction (docs/kairos/34 §1). Nightly, after the 02:30 UTC
// archetype run: one job per user when the operator has said something new
// since the last completed extraction (watermark = that job's inputsUntil).
// apply writes new beliefs, supersedes replaced ones and reinforces restated
// ones, atomically with their memory_ops rows. Fallback: the paid heavy key.

export const BELIEF_EXTRACT_KIND = 'belief_extract'
export const BELIEF_EXTRACT_EARLIEST_UTC = { hour: 2, minute: 30 }
export const BELIEF_EXTRACT_DEADLINE_MINUTES = 4 * 60
export const BELIEF_EXTRACT_MAX_OUTPUT_TOKENS = 4000
export const HELD_IN_PROMPT_CAP = 150

export const beliefExtractJobKey = (day: string) => `${BELIEF_EXTRACT_KIND}:${day}`

const OPEN = new Set(['queued', 'claimed'])

const contextSchema = z.object({
  day: z.string().min(1),
  inputIds: z.array(z.string().min(1)).min(1),
  inputsUntil: z.string().min(1),
  heldIds: z.array(z.string().min(1)),
  dominions: z.array(z.object({ id: z.string().min(1), name: z.string() })),
})

export type BeliefExtractContext = z.infer<typeof contextSchema>

// An unfinished job (open, or expired with its fallback not yet tried) owns
// the inputs; planning another would extract them twice.
export function extractInFlight(jobs: readonly ExtractJobState[]): boolean {
  return jobs.some((j) => OPEN.has(j.status) || (j.status === 'expired' && !(j.error ?? '').startsWith(FALLBACK_ERROR_PREFIX)))
}

export function extractWatermark(jobs: readonly ExtractJobState[]): Date | null {
  return jobs.find((j) => j.status === 'done' || j.status === 'fallback')?.inputsUntil ?? null
}

// `rows` arrive oldest first. A full batch may have cut a run of rows sharing
// its last timestamp, and the strict `>` watermark would then skip the unread
// ones — so a full batch gives back every row at its last timestamp (unless
// that empties it); they lead the next night's batch.
export function drainBatch<T extends { createdAt: Date }>(rows: readonly T[], cap: number): T[] {
  if (rows.length < cap) return [...rows]
  const last = rows[rows.length - 1].createdAt.getTime()
  const kept = rows.filter((r) => r.createdAt.getTime() < last)
  return kept.length > 0 ? kept : [...rows]
}

export async function planBeliefExtract(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (now.getTime() < deadlineOn(now, BELIEF_EXTRACT_EARLIEST_UTC).getTime()) return []
  const externalKey = beliefExtractJobKey(utcDay(now))
  if (await thinkingJobKeyExists(userId, externalKey)) return []
  const jobs = await listRecentExtractJobs(userId)
  if (extractInFlight(jobs)) return []

  // Oldest first, capped: a backlog drains over successive nights because the
  // watermark is the newest row actually consumed, never the newest overall.
  const consumed = drainBatch(await listOperatorSignals(userId, extractWatermark(jobs), SIGNAL_INPUT_CAP), SIGNAL_INPUT_CAP)
  if (consumed.length === 0) return []
  const inputsUntil = consumed[consumed.length - 1].createdAt
  // The prompt and its provenance list read newest first.
  const inputs = [...consumed].reverse()
  const held = await listHeldBeliefs(userId, 'aligned', HELD_IN_PROMPT_CAP)
  const dominions = (await findDominionsByUser(userId))
    .filter((d) => !d.archivedAt)
    .map((d) => ({ id: d.id, name: d.name }))
  const context: BeliefExtractContext = {
    day: utcDay(now),
    inputIds: inputs.map((r) => r.id),
    inputsUntil: inputsUntil.toISOString(),
    heldIds: held.map((b) => b.id),
    dominions,
  }
  return [{
    kind: BELIEF_EXTRACT_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes: BELIEF_EXTRACT_DEADLINE_MINUTES,
    input: {
      system: EXTRACT_SYSTEM_PROMPT,
      prompt: buildExtractPrompt({ dominions, held, inputs }),
      validMemoryIds: [...context.inputIds, ...context.heldIds],
      context,
      maxOutputTokens: BELIEF_EXTRACT_MAX_OUTPUT_TOKENS,
    },
  }]
}

function readContext(job: ThinkingJobRow): BeliefExtractContext | null {
  const parsed = contextSchema.safeParse(job.input.context)
  return parsed.success ? parsed.data : null
}

function parse(text: string, ctx: BeliefExtractContext): GroundedClaim[] {
  return parseExtractText(text, { inputIds: ctx.inputIds, heldIds: ctx.heldIds, dominions: ctx.dominions })
}

export function alignedBelief(c: GroundedClaim): BeliefV1 {
  return {
    v: 1,
    mind: 'aligned',
    domain: c.domain,
    dominionId: c.dominionId,
    claim: c.claim,
    reasons: c.reasons,
    falsifier: c.falsifier,
    sourceType: 'operator',
    provenance: c.provenance,
    status: 'held',
    confidence: c.confidence,
    ...(c.relation === 'replaces' && c.targetId ? { supersedes: c.targetId } : {}),
  }
}

async function persist(job: ThinkingJobRow, claims: GroundedClaim[], answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const create: AlignedCreate[] = []
  const reinforce: AlignedReinforce[] = []
  for (const c of claims) {
    if (c.relation === 'reinforces' && c.targetId) {
      reinforce.push({ targetId: c.targetId, provenance: c.provenance, reason: `aligned mind: operator restated "${c.claim}" via ${answeredBy}` })
      continue
    }
    create.push({
      values: beliefRowValues(alignedBelief(c), { extractKey: job.externalKey, jobId: job.id, answeredBy }),
      supersedes: c.relation === 'replaces' ? c.targetId : null,
      reason: `aligned mind: "${c.claim}" from ${c.provenance.length} operator input(s) via ${answeredBy}`,
    })
  }
  const res = await writeAlignedBeliefs(job.userId, job.id, job.externalKey, { create, reinforce })
  return { ok: true, memoryIds: [...res.created, ...res.reinforced] }
}

export async function applyBeliefExtract(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid belief_extract context' }
  let claims: GroundedClaim[]
  try {
    claims = parse(text, ctx)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  return persist(job, claims, answeredBy)
}

export async function fallbackBeliefExtract(job: ThinkingJobRow): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid belief_extract context' }
  const res = await askPaidAndParse(job, {
    parse: (t) => parse(t, ctx),
    label: BELIEF_EXTRACT_KIND,
    maxTokens: job.input.maxOutputTokens ?? BELIEF_EXTRACT_MAX_OUTPUT_TOKENS,
    repairContext: [
      'Valid provenance ids (operator inputs) — copy verbatim:',
      ...ctx.inputIds.map((id) => `- ${id}`),
      'Valid targetId values (held aligned beliefs):',
      ...(ctx.heldIds.length ? ctx.heldIds.map((id) => `- ${id}`) : ['(none — use null)']),
    ].join('\n'),
  })
  if (!res.ok) return res
  return persist(job, res.value, 'api')
}

export const beliefExtractHandler: ThinkingJobHandler = {
  kind: BELIEF_EXTRACT_KIND,
  plan: planBeliefExtract,
  apply: applyBeliefExtract,
  fallback: fallbackBeliefExtract,
}
