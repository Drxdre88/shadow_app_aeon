import { z } from 'zod'
import { findDominionsByUser } from '@/lib/data/dominions'
import {
  listBeliefEvidence,
  listHeldBeliefs,
  listMemoryOrigins,
  listOperatorSignals,
  listRecentExtractJobs,
  SIGNAL_INPUT_CAP,
  thinkingJobKeyExists,
  writeAlignedBeliefs,
  type AlignedCreate,
  type AlignedReinforce,
  type ExtractJobState,
} from '@/lib/data/beliefs'
import { listFlaggedAlignedBeliefs, listOpenAlignedBeliefs, RECHECK_IN_PROMPT_CAP } from '@/lib/data/belief-recheck'
import { FALLBACK_ERROR_PREFIX } from '@/lib/data/thinking-jobs'
import {
  EXTRACT_SYSTEM_PROMPT,
  EXTRACT_SYSTEM_PROMPT_SURPRISE,
  buildExtractPrompt,
  parseExtractAnswer,
  type GroundedClaim,
  type GroundedExtraction,
  type QuestionedBeliefRef,
  type RecheckBeliefRef,
} from '@/lib/kairos/beliefs/extract-prompt'
import { sourceTypeOf } from '@/lib/kairos/beliefs/support'
import { capBeliefConfidence, type BeliefSourceType } from '@/lib/kairos/origin'
import { surpriseGateMode } from '@/lib/kairos/surprise/flag'
import { latestSignalAt, openWhy } from '@/lib/kairos/surprise/gate'
import { recordBeliefExtractSurprises } from '@/lib/kairos/surprise/extract-signals'
import { askPaidAndParse } from '../paid-fallback'
import { beliefRowValues, remainingProvenance, type BeliefV1 } from '@/lib/kairos/beliefs/types'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { deadlineOn, utcDay } from '../deadlines'
import { errorReason } from './_errors'
import { beliefExtractThoughts, withThoughts } from '../stage-thoughts'

// Aligned-mind extraction (docs/kairos/34 §1). Nightly, after the 02:30 UTC
// archetype run: one job per user when something new was said since the last
// completed extraction (watermark = that job's inputsUntil) OR a held aligned
// belief was flagged by the engine's re-check step and not yet put to the
// model. apply writes new beliefs, supersedes replaced ones, reinforces
// (reaffirms) restated ones and retires flagged ones, atomically with their
// memory_ops rows. The server, not the model, sets each belief's sourceType
// (from its provenance origins) and caps its confidence. Fallback: paid key.

export const BELIEF_EXTRACT_KIND = 'belief_extract'
export const BELIEF_EXTRACT_EARLIEST_UTC = { hour: 2, minute: 30 }
export const BELIEF_EXTRACT_DEADLINE_MINUTES = 4 * 60
export const BELIEF_EXTRACT_MAX_OUTPUT_TOKENS = 4000
export const HELD_IN_PROMPT_CAP = 150

export const beliefExtractJobKey = (day: string) => `${BELIEF_EXTRACT_KIND}:${day}`

const OPEN = new Set(['queued', 'claimed'])
const SETTLED = new Set(['done', 'fallback'])

const contextSchema = z.object({
  day: z.string().min(1),
  inputIds: z.array(z.string().min(1)),
  // Null on a flags-only job planned before any input was ever consumed.
  inputsUntil: z.string().min(1).nullable(),
  heldIds: z.array(z.string().min(1)),
  dominions: z.array(z.object({ id: z.string().min(1), name: z.string() })),
  // P2.5 re-examination: flagged aligned beliefs + their remaining evidence ids.
  flaggedIds: z.array(z.string().min(1)).default([]),
  evidenceIds: z.array(z.string().min(1)).default([]),
  // Surprise gate (on): beliefs open for update the job put to the model.
  openIds: z.array(z.string().min(1)).default([]),
}).refine((c) => c.inputIds.length + c.flaggedIds.length + c.openIds.length > 0, 'nothing to extract')

export type BeliefExtractContext = z.infer<typeof contextSchema>

// An unfinished job (open, or expired with its fallback not yet tried) owns
// the inputs; planning another would extract them twice.
export function extractInFlight(jobs: readonly ExtractJobState[]): boolean {
  return jobs.some((j) => OPEN.has(j.status) || (j.status === 'expired' && !(j.error ?? '').startsWith(FALLBACK_ERROR_PREFIX)))
}

export function extractWatermark(jobs: readonly ExtractJobState[]): Date | null {
  return jobs.find((j) => SETTLED.has(j.status) && j.inputsUntil)?.inputsUntil ?? null
}

// Flagged beliefs a recently settled job already put to the model; they wait
// for new signals rather than re-planning the same question every night.
// Flag ids settled jobs presented, least recently presented first (`jobs`
// arrive newest first): the rotation order for the next prompt window.
export function presentedFlagOrder(jobs: readonly ExtractJobState[]): string[] {
  const newestFirst: string[] = []
  const seen = new Set<string>()
  for (const j of jobs) {
    if (!SETTLED.has(j.status)) continue
    for (const id of j.flaggedIds ?? []) {
      if (!seen.has(id)) {
        seen.add(id)
        newestFirst.push(id)
      }
    }
  }
  return newestFirst.reverse()
}

export function presentedFlags(jobs: readonly ExtractJobState[]): Set<string> {
  return new Set(jobs.filter((j) => SETTLED.has(j.status)).flatMap((j) => j.flaggedIds ?? []))
}

// Open belief id → when a settled job last put it to the model (ms). An open
// belief waits for a newer surprise signal before it alone plans a job again.
export function presentedOpenAt(jobs: readonly ExtractJobState[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const j of jobs) {
    if (!SETTLED.has(j.status)) continue
    const at = j.plannedAt?.getTime() ?? 0
    for (const id of j.openIds ?? []) out.set(id, Math.max(out.get(id) ?? 0, at))
  }
  return out
}

// `rows` arrive oldest first. A full batch may have cut a run of rows sharing
// its last timestamp, and the strict `>` watermark would then skip the unread
// ones, so a full batch gives back every row at its last timestamp (unless
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
  const watermark = extractWatermark(jobs)
  const consumed = drainBatch(await listOperatorSignals(userId, watermark, SIGNAL_INPUT_CAP), SIGNAL_INPUT_CAP)
  // Unpresented flags lead the window, so if any exists it is in `flagged`.
  const flagged = await listFlaggedAlignedBeliefs(userId, RECHECK_IN_PROMPT_CAP, presentedFlagOrder(jobs))
  const presented = presentedFlags(jobs)
  // Surprise gate on: beliefs open for update share the re-check window.
  const gateOn = surpriseGateMode() === 'on'
  const open = gateOn ? await listOpenAlignedBeliefs(userId, now, RECHECK_IN_PROMPT_CAP - flagged.length) : []
  const openSeen = presentedOpenAt(jobs)
  const freshOpen = open.some((o) => {
    const seen = openSeen.get(o.id)
    const signal = latestSignalAt(o.sourceMetadata)
    return seen === undefined || (signal !== null && signal > seen)
  })
  if (consumed.length === 0 && !flagged.some((f) => !presented.has(f.id)) && !freshOpen) return []

  // A flags-only night carries the old watermark forward.
  const inputsUntil = consumed.length ? consumed[consumed.length - 1].createdAt : watermark
  // The prompt and its provenance list read newest first.
  const inputs = [...consumed].reverse()
  const inputIds = inputs.map((r) => r.id)
  const evidence = await listBeliefEvidence(userId, [...new Set(flagged.flatMap((f) => remainingProvenance(f.belief)))])
  const evidenceById = new Map(evidence.map((r) => [r.id, r]))
  const recheck: RecheckBeliefRef[] = flagged.map((f) => ({
    id: f.id,
    domain: f.belief.domain,
    claim: f.belief.claim,
    lostCount: f.belief.recheck.lostSources.length,
    remaining: remainingProvenance(f.belief).flatMap((id) => evidenceById.get(id) ?? []),
  }))
  const inputSet = new Set(inputIds)
  const evidenceIds = evidence.map((r) => r.id).filter((id) => !inputSet.has(id))
  const held = await listHeldBeliefs(userId, 'aligned', HELD_IN_PROMPT_CAP)
  const dominions = (await findDominionsByUser(userId))
    .filter((d) => !d.archivedAt)
    .map((d) => ({ id: d.id, name: d.name }))
  const flaggedIds = flagged.map((f) => f.id)
  const openIds = open.map((o) => o.id)
  const questioned: QuestionedBeliefRef[] = open.map((o) => ({ id: o.id, domain: o.belief.domain, claim: o.belief.claim, why: openWhy(o.sourceMetadata) }))
  const context: z.input<typeof contextSchema> = {
    day: utcDay(now),
    inputIds,
    inputsUntil: inputsUntil ? inputsUntil.toISOString() : null,
    heldIds: [...new Set([...held.map((b) => b.id), ...flaggedIds, ...openIds])],
    dominions,
    flaggedIds,
    evidenceIds,
    ...(openIds.length ? { openIds } : {}),
  }
  return [{
    kind: BELIEF_EXTRACT_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes: BELIEF_EXTRACT_DEADLINE_MINUTES,
    input: {
      system: gateOn ? EXTRACT_SYSTEM_PROMPT_SURPRISE : EXTRACT_SYSTEM_PROMPT,
      prompt: buildExtractPrompt({ dominions, held, inputs, recheck, ...(questioned.length ? { questioned } : {}) }),
      validMemoryIds: [...context.inputIds, ...(context.evidenceIds ?? []), ...context.heldIds],
      context,
      maxOutputTokens: BELIEF_EXTRACT_MAX_OUTPUT_TOKENS,
    },
  }]
}

function readContext(job: ThinkingJobRow): BeliefExtractContext | null {
  const parsed = contextSchema.safeParse(job.input.context)
  return parsed.success ? parsed.data : null
}

function parse(text: string, ctx: BeliefExtractContext): GroundedExtraction {
  return parseExtractAnswer(text, {
    inputIds: [...ctx.inputIds, ...ctx.evidenceIds],
    heldIds: ctx.heldIds,
    dominions: ctx.dominions,
    flaggedIds: ctx.flaggedIds,
    ...(ctx.openIds.length ? { openIds: ctx.openIds } : {}),
  })
}

// sourceType and the confidence ceiling come from the provenance rows'
// origins, never from the model.
export function alignedBelief(c: GroundedClaim, sourceType: BeliefSourceType): BeliefV1 {
  return {
    v: 1,
    mind: 'aligned',
    domain: c.domain,
    dominionId: c.dominionId,
    claim: c.claim,
    reasons: c.reasons,
    falsifier: c.falsifier,
    sourceType,
    provenance: c.provenance,
    status: 'held',
    confidence: capBeliefConfidence(c.confidence, sourceType),
    ...(c.relation === 'replaces' && c.targetId ? { supersedes: c.targetId } : {}),
  }
}

async function persist(job: ThinkingJobRow, ctx: BeliefExtractContext, answer: GroundedExtraction, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const create: AlignedCreate[] = []
  const reinforce: AlignedReinforce[] = []
  const creates = answer.claims.filter((c) => !(c.relation === 'reinforces' && c.targetId))
  const origins = await listMemoryOrigins(job.userId, creates.flatMap((c) => c.provenance))
  for (const c of answer.claims) {
    if (c.relation === 'reinforces' && c.targetId) {
      reinforce.push({ targetId: c.targetId, provenance: c.provenance, confidence: c.confidence, reason: `aligned mind: restated "${c.claim}" via ${answeredBy}` })
      continue
    }
    const sourceType = sourceTypeOf(c.provenance, origins)
    create.push({
      values: beliefRowValues(alignedBelief(c, sourceType), { extractKey: job.externalKey, jobId: job.id, answeredBy }),
      supersedes: c.relation === 'replaces' ? c.targetId : null,
      reason: `aligned mind: "${c.claim}" from ${c.provenance.length} input(s), ${sourceType}-sourced, via ${answeredBy}`,
    })
  }
  const res = await writeAlignedBeliefs(job.userId, job.id, job.externalKey, {
    create,
    reinforce,
    retire: answer.retire,
    ...(ctx.openIds.length ? { openIds: ctx.openIds } : {}),
  })
  if (res.refusedReplaces.length) {
    console.info(`[belief_extract] ${job.id}: inference-only replace refused for ${res.refusedReplaces.join(', ')}; held as new beliefs`)
  }
  if (res.gatedReplaces?.length) {
    console.info(`[belief_extract] ${job.id}: replace gated (not open) for ${res.gatedReplaces.join(', ')}; held beside`)
  }
  if (res.written && res.ownerCorrections) {
    await recordBeliefExtractSurprises(job.userId, job.externalKey, {
      inputIds: ctx.inputIds,
      questionedIds: [...ctx.flaggedIds, ...ctx.openIds],
      create,
      reinforce,
      result: res,
    })
  }
  return withThoughts({ ok: true, memoryIds: [...res.created, ...res.reinforced, ...res.retired] }, beliefExtractThoughts(answer))
}

export async function applyBeliefExtract(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid belief_extract context' }
  let answer: GroundedExtraction
  try {
    answer = parse(text, ctx)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  return persist(job, ctx, answer, answeredBy)
}

export async function fallbackBeliefExtract(job: ThinkingJobRow): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid belief_extract context' }
  const provenanceIds = [...ctx.inputIds, ...ctx.evidenceIds]
  const res = await askPaidAndParse(job, {
    parse: (t) => parse(t, ctx),
    label: BELIEF_EXTRACT_KIND,
    maxTokens: job.input.maxOutputTokens ?? BELIEF_EXTRACT_MAX_OUTPUT_TOKENS,
    repairContext: [
      'Valid provenance ids (inputs and remaining evidence) - copy verbatim:',
      ...(provenanceIds.length ? provenanceIds.map((id) => `- ${id}`) : ['(none)']),
      'Valid targetId values (held aligned beliefs):',
      ...(ctx.heldIds.length ? ctx.heldIds.map((id) => `- ${id}`) : ['(none - use null)']),
      ...(ctx.openIds.length
        ? ['Valid retire targetId values (beliefs that lost support or were questioned by events):', ...[...ctx.flaggedIds, ...ctx.openIds].map((id) => `- ${id}`)]
        : ['Valid retire targetId values (beliefs that lost support):', ...(ctx.flaggedIds.length ? ctx.flaggedIds.map((id) => `- ${id}`) : ['(none - leave "retire" empty)'])]),
    ].join('\n'),
  })
  if (!res.ok) return res
  return persist(job, ctx, res.value, 'api')
}

export const beliefExtractHandler: ThinkingJobHandler = {
  kind: BELIEF_EXTRACT_KIND,
  plan: planBeliefExtract,
  apply: applyBeliefExtract,
  fallback: fallbackBeliefExtract,
}
