import { randomUUID } from 'node:crypto'
import { findPromiseTask } from '@/lib/data/kairos-promises'
import { mutateKairosPredictions } from '@/lib/data/kairos-predictions'
import { verifyProjectAccess } from '@/lib/data/projects'
import {
  MAX_OPEN_PREDICTIONS,
  MAX_PREDICTIONS_PER_DAY,
  MAX_PREDICTIONS_PER_SOURCE,
  MAX_PREDICTION_BASIS,
  predictionProposalSchema,
  predictionSourceSchema,
  predictionTopicSchema,
  type KairosPrediction,
  type PredictionCheck,
  type PredictionSource,
} from '@/lib/data/validators/kairos-predictions'
import { DONE_COLUMN_NAMES } from '@/lib/kairos/auto-capture'
import { makeFedIdResolver } from '@/lib/kairos/introspection-prompt'
import { isDueInWindow } from '@/lib/kairos/promises/rules'
import { predictionsEnabled } from './flag'
import { createdOnLondonDay, isHedgedClaim, normaliseClaim, snapProbability } from './rules'

// Kairos makes predictions only through the server: the weekly review (and,
// from wave 2, reflect). Every field is re-validated here; status is always
// 'open', the check kind is decided server-side, and the basis is grounded to
// the job's fed memory ids. Kairos can create — never settle.

export type PredictionRejectReason =
  | 'disabled'
  | 'invalid'
  | 'hedged'
  | 'probability_out_of_range'
  | 'due_out_of_window'
  | 'card_already_done'
  | 'over_per_call_cap'
  | 'over_open_cap'
  | 'over_daily_cap'
  | 'duplicate'
  | 'duplicate_task'
  | 'duplicate_source'

export interface CreatePredictionsResult {
  created: KairosPrediction[]
  rejected: Array<{ index: number; reason: PredictionRejectReason }>
  // Valid predictions dropped by the per-call, open or daily cap.
  overflow: number
}

export interface CreatePredictionsOptions {
  // The job's fed memory ids; basisIds outside this set are dropped.
  validMemoryIds?: Iterable<string>
  dominions?: ReadonlyArray<{ id: string; name: string }>
  now?: Date
}

interface Candidate {
  index: number
  claim: string
  probability: number
  dueDate: string
  topic: KairosPrediction['topic']
  dominionId: string | null
  basisIds: string[]
  check: PredictionCheck
}

const blank = (v: unknown) => v === null || v === undefined || v === ''

// Maps the lenient model shape (nulls, string probability, unknown topic)
// onto the strict proposal schema.
function cleanProposal(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (!blank(v)) out[k] = v
  if (typeof out.probability === 'string') out.probability = Number(out.probability)
  if (typeof out.topic === 'string' && !predictionTopicSchema.safeParse(out.topic).success) out.topic = 'other'
  return out
}

function resolveDominion(raw: string | undefined, dominions: CreatePredictionsOptions['dominions']): string | null {
  if (!raw || !dominions) return null
  const key = raw.trim().toLowerCase()
  return dominions.find((d) => d.id === raw || d.name.trim().toLowerCase() === key)?.id ?? null
}

type CheckResolution = { check: PredictionCheck } | { reject: 'card_already_done' }

// card_by only for a live, not-yet-done card the user can reach; a done card
// is rejected; a missing or unreachable card falls back to owner_verdict.
async function resolveCheck(userId: string, taskId: string | undefined, expect: 'done' | 'not_done'): Promise<CheckResolution> {
  if (!taskId) return { check: { kind: 'owner_verdict' } }
  const task = await findPromiseTask(taskId)
  if (!task) return { check: { kind: 'owner_verdict' } }
  const done = task.status === 'done' || task.completedAt !== null || task.archivedAt !== null ||
    (task.columnName !== null && DONE_COLUMN_NAMES.has(task.columnName.trim().toLowerCase()))
  if (done) return { reject: 'card_already_done' }
  const access = await verifyProjectAccess(task.projectId, userId)
  return access
    ? { check: { kind: 'card_by', projectId: task.projectId, taskId: task.id, expect } }
    : { check: { kind: 'owner_verdict' } }
}

export async function createKairosPredictions(
  userId: string,
  proposals: readonly unknown[],
  source: PredictionSource,
  opts: CreatePredictionsOptions = {},
): Promise<CreatePredictionsResult> {
  if (!predictionsEnabled()) {
    return { created: [], rejected: proposals.map((_, index) => ({ index, reason: 'disabled' as const })), overflow: 0 }
  }
  const now = opts.now ?? new Date()
  const src = predictionSourceSchema.parse(source)
  const perCall = MAX_PREDICTIONS_PER_SOURCE[src.kind]
  const resolveBasis = makeFedIdResolver(opts.validMemoryIds ?? [])
  const rejected: CreatePredictionsResult['rejected'] = []
  let overflow = 0
  const candidates: Candidate[] = []

  for (const [index, raw] of proposals.entries()) {
    if (index >= perCall) {
      rejected.push({ index, reason: 'over_per_call_cap' })
      overflow++
      continue
    }
    const parsed = predictionProposalSchema.safeParse(cleanProposal(raw))
    if (!parsed.success) { rejected.push({ index, reason: 'invalid' }); continue }
    const p = parsed.data
    if (isHedgedClaim(p.claim)) { rejected.push({ index, reason: 'hedged' }); continue }
    const probability = snapProbability(p.probability)
    if (probability === null) { rejected.push({ index, reason: 'probability_out_of_range' }); continue }
    if (!isDueInWindow(p.dueDate, now)) { rejected.push({ index, reason: 'due_out_of_window' }); continue }
    const resolved = await resolveCheck(userId, p.taskId, p.expect ?? 'done')
    if ('reject' in resolved) { rejected.push({ index, reason: resolved.reject }); continue }
    const basisIds = [...new Set(p.basisIds.map(resolveBasis).filter((id): id is string => id !== null))].slice(0, MAX_PREDICTION_BASIS)
    candidates.push({
      index,
      claim: p.claim,
      probability,
      dueDate: p.dueDate,
      topic: p.topic,
      dominionId: resolveDominion(p.dominion, opts.dominions),
      basisIds,
      check: resolved.check,
    })
  }

  if (candidates.length === 0) return { created: [], rejected, overflow }

  const ids = candidates.map(() => randomUUID())
  const outcome = await mutateKairosPredictions(userId, (state) => {
    const created: KairosPrediction[] = []
    const lateRejects: CreatePredictionsResult['rejected'] = []
    let capped = 0
    if ([...state.open, ...state.closed].some((p) => p.source.kind === src.kind && p.source.jobId === src.jobId)) {
      return { state: null, result: { created, lateRejects: candidates.map((c) => ({ index: c.index, reason: 'duplicate_source' as const })), capped } }
    }
    const claims = new Set(state.open.map((p) => normaliseClaim(p.claim)))
    const tasks = new Set(state.open.flatMap((p) => (p.check.kind === 'card_by' ? [`${p.check.taskId}:${p.check.expect}`] : [])))
    const today = createdOnLondonDay(state, now)
    let nextSeq = state.nextSeq
    for (const [i, c] of candidates.entries()) {
      const claimKey = normaliseClaim(c.claim)
      const taskKey = c.check.kind === 'card_by' ? `${c.check.taskId}:${c.check.expect}` : null
      if (claims.has(claimKey)) { lateRejects.push({ index: c.index, reason: 'duplicate' }); continue }
      if (taskKey && tasks.has(taskKey)) { lateRejects.push({ index: c.index, reason: 'duplicate_task' }); continue }
      if (state.open.length + created.length >= MAX_OPEN_PREDICTIONS) {
        lateRejects.push({ index: c.index, reason: 'over_open_cap' })
        capped++
        continue
      }
      if (today + created.length >= MAX_PREDICTIONS_PER_DAY) {
        lateRejects.push({ index: c.index, reason: 'over_daily_cap' })
        capped++
        continue
      }
      claims.add(claimKey)
      if (taskKey) tasks.add(taskKey)
      created.push({
        id: ids[i]!,
        seq: nextSeq++,
        claim: c.claim,
        probability: c.probability,
        dueDate: c.dueDate,
        topic: c.topic,
        dominionId: c.dominionId,
        basisIds: c.basisIds,
        check: c.check,
        source: src,
        createdAt: now.toISOString(),
        status: 'open',
      })
    }
    if (created.length === 0) return { state: null, result: { created, lateRejects, capped } }
    return { state: { ...state, nextSeq, open: [...state.open, ...created] }, result: { created, lateRejects, capped } }
  })

  return {
    created: outcome.created,
    rejected: [...rejected, ...outcome.lateRejects].sort((a, b) => a.index - b.index),
    overflow: overflow + outcome.capped,
  }
}
