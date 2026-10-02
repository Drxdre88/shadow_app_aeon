import { randomUUID } from 'node:crypto'
import { findPromiseTask, mutateKairosPromises } from '@/lib/data/kairos-promises'
import { verifyProjectAccess } from '@/lib/data/projects'
import {
  MAX_OPEN_PROMISES,
  MAX_PROMISES_PER_CALL,
  promiseProposalSchema,
  promiseSourceSchema,
  type KairosPromise,
  type PromiseCheck,
  type PromiseSource,
} from '@/lib/data/validators/kairos-promises'
import { DONE_COLUMN_NAMES } from '@/lib/kairos/auto-capture'
import { isDueInWindow, isVagueOutcome, normaliseOutcome } from './rules'

// Kairos makes promises only through the server: the weekly review (when the
// initiative switch is on) and goal approval. Every field is re-validated
// here; status is always 'open' and the check kind is decided server-side.

export type PromiseRejectReason =
  | 'invalid'
  | 'vague_outcome'
  | 'due_out_of_window'
  | 'over_per_call_cap'
  | 'over_open_cap'
  | 'duplicate'
  | 'duplicate_source'

export interface CreatePromisesResult {
  created: KairosPromise[]
  rejected: Array<{ index: number; reason: PromiseRejectReason }>
  // Valid promises dropped by the per-call (3) or open (12) cap.
  overflow: number
}

interface Candidate {
  index: number
  outcome: string
  dueDate: string
  check: PromiseCheck
}

function cleanProposal(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const { taskId, ...rest } = raw as Record<string, unknown>
  return taskId === null || taskId === undefined || taskId === '' ? rest : { ...rest, taskId }
}

// card_done only for a live card the user can reach; anything else falls
// back to owner_confirm (never rejected for a bad card id).
async function resolveCheck(userId: string, taskId: string | undefined): Promise<PromiseCheck> {
  if (!taskId) return { kind: 'owner_confirm' }
  const task = await findPromiseTask(taskId)
  if (!task) return { kind: 'owner_confirm' }
  const done = task.status === 'done' || task.completedAt !== null || task.archivedAt !== null ||
    (task.columnName !== null && DONE_COLUMN_NAMES.has(task.columnName.trim().toLowerCase()))
  if (done) return { kind: 'owner_confirm' }
  const access = await verifyProjectAccess(task.projectId, userId)
  return access ? { kind: 'card_done', projectId: task.projectId, taskId: task.id } : { kind: 'owner_confirm' }
}

function sameSource(a: PromiseSource, b: PromiseSource): boolean {
  if (a.kind !== b.kind) return false
  if (b.jobId && a.jobId === b.jobId) return true
  return !!b.goalId && a.goalId === b.goalId
}

export async function createKairosPromises(
  userId: string,
  proposals: readonly unknown[],
  source: PromiseSource,
  now: Date = new Date(),
): Promise<CreatePromisesResult> {
  const src = promiseSourceSchema.parse(source)
  const rejected: CreatePromisesResult['rejected'] = []
  let overflow = 0
  const candidates: Candidate[] = []

  for (const [index, raw] of proposals.entries()) {
    if (index >= MAX_PROMISES_PER_CALL) {
      rejected.push({ index, reason: 'over_per_call_cap' })
      overflow++
      continue
    }
    const parsed = promiseProposalSchema.safeParse(cleanProposal(raw))
    if (!parsed.success) { rejected.push({ index, reason: 'invalid' }); continue }
    const { outcome, dueDate, taskId } = parsed.data
    if (isVagueOutcome(outcome)) { rejected.push({ index, reason: 'vague_outcome' }); continue }
    if (!isDueInWindow(dueDate, now)) { rejected.push({ index, reason: 'due_out_of_window' }); continue }
    candidates.push({ index, outcome, dueDate, check: await resolveCheck(userId, taskId) })
  }

  if (candidates.length === 0) return { created: [], rejected, overflow }

  const ids = candidates.map(() => randomUUID())
  const outcome = await mutateKairosPromises(userId, (state) => {
    const created: KairosPromise[] = []
    const lateRejects: CreatePromisesResult['rejected'] = []
    let capped = 0
    if ((src.jobId || src.goalId) && [...state.open, ...state.closed].some((p) => sameSource(p.source, src))) {
      return { state: null, result: { created, lateRejects: candidates.map((c) => ({ index: c.index, reason: 'duplicate_source' as const })), capped } }
    }
    const seen = new Set(state.open.map((p) => normaliseOutcome(p.outcome)))
    let nextSeq = state.nextSeq
    for (const [i, c] of candidates.entries()) {
      const key = normaliseOutcome(c.outcome)
      if (seen.has(key)) { lateRejects.push({ index: c.index, reason: 'duplicate' }); continue }
      if (state.open.length + created.length >= MAX_OPEN_PROMISES) {
        lateRejects.push({ index: c.index, reason: 'over_open_cap' })
        capped++
        continue
      }
      seen.add(key)
      created.push({
        id: ids[i]!,
        seq: nextSeq++,
        outcome: c.outcome,
        dueDate: c.dueDate,
        createdAt: now.toISOString(),
        source: src,
        check: c.check,
        status: 'open',
        renegotiations: 0,
        dueHistory: [],
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
