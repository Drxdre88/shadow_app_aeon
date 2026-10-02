import {
  applyMerge,
  findOlderDuplicate,
  listMergeCandidates,
  type MergeCandidateRow,
} from '@/lib/data/memory-candidates'
import { errorMessage, outOfTime } from '../deadline'
import type { EngineRunContext, MemoryOpInput, Step, StepResult } from '../types'
import { isVetoed } from './back-up'

// Gate/Merge (docs/kairos/32 §2.1). A new row that is a near-verbatim repeat
// (cosine ≥ 0.95) of an OLDER live row of the same stream class is folded in
// as a reinforcement: the newer is superseded by the older (valid time kept —
// it is a repeat, not a correction) and the older gets useCount+1 /
// lastUsedAt=now. Never for reflections, pinned rows, synthesised documents
// (concept/cortex/aether/archetype) or inbox/ask rows with their own lifecycle.
//
// Window: rows CREATED in the last 96h that are embedded by now. Most rows are
// embedded only by the 03:25 UTC embed-backfill (≤200/day) while Merge runs at
// 01:30 UTC, so a row written just after 03:25 is first embedded ~46h later —
// a 36h window never saw it (G3). 96h gives every row at least two nights
// after its embedding. A row with no duplicate is simply re-checked on later
// nights: the no-duplicate path is one read-only nearest-neighbour query (no
// write, no op), so re-examination costs ~4 lookups over the row's lifetime.
// Candidates are oldest-first (createdAt, id) so the per-night cap always
// reaches the rows about to leave the window; with ≤ cap/day embedded rows
// every row is examined at least once. Rows already superseded drop out of
// the candidate list (liveRow), so a merged row is never re-examined.

export const MERGE_MIN_COSINE = 0.95
export const MERGE_WINDOW_HOURS = 96
// ≈2× the embed-backfill's daily cap; ~one indexed lookup per row, well inside
// the engine's 230s budget, and the per-row outOfTime check still stops early.
export const MERGE_CANDIDATE_CAP = 400

export const MERGE_EXCLUDED_TYPES = [
  'concept',
  'cortex',
  'dominion_cortex',
  'aether',
  'archetype',
  'reflection',
  // Kairos inbox messages + proposals (BackUp's tier) and asks carry their own
  // delivery/answer lifecycle; superseding them would hide live threads.
  'inbound',
  'advisory',
  // P2 (doc 34): beliefs and the constitution are never machine-merged.
  'belief',
  'constitution',
] as const

export const MERGE_EXCLUDED_STREAMS = ['reflection', 'concept', 'cortex', 'aether', 'archetype', 'belief', 'constitution'] as const

export class MergeStep implements Step {
  readonly name = 'merge'
  readonly budgetMs?: number

  constructor(private readonly opts: { cap?: number; budgetMs?: number } = {}) {
    this.budgetMs = opts.budgetMs
  }

  async run(ctx: EngineRunContext): Promise<StepResult> {
    const since = new Date(ctx.now.getTime() - MERGE_WINDOW_HOURS * 3_600_000)
    const rows = await listMergeCandidates(ctx.userId, since, {
      excludeTypes: MERGE_EXCLUDED_TYPES,
      excludeStreams: MERGE_EXCLUDED_STREAMS,
      limit: this.opts.cap ?? MERGE_CANDIDATE_CAP,
    })

    // Rows folded away this run can't be merge targets (matters in dryRun,
    // where nothing is written and the DB still shows them live).
    const mergedAway: string[] = []
    const errors: string[] = []
    let changed = 0
    let examined = 0
    let stopped = false
    for (const row of rows) {
      if (outOfTime(ctx)) {
        stopped = true
        break
      }
      examined++
      if (isVetoed(row.sourceMetadata, 'merge')) continue
      try {
        if (await this.mergeRow(ctx, row, mergedAway)) changed++
      } catch (err) {
        errors.push(`${row.id}: ${errorMessage(err)}`)
      }
    }
    const notes: string[] = []
    if (errors.length) notes.push(`failed=${errors.length}`)
    if (stopped) notes.push(`out of time after ${examined}/${rows.length}`)
    return {
      step: this.name,
      examined,
      changed,
      ...(notes.length ? { notes } : {}),
      ...(ctx.dryRun ? {} : { opsWritten: changed }),
      ...(errors.length ? { errors } : {}),
      ...(stopped ? { outOfTime: true } : {}),
    }
  }

  // Live: the merge and its op commit in one transaction (a failed op insert
  // rolls the merge back and throws). Dry run: report the op only.
  private async mergeRow(ctx: EngineRunContext, row: MergeCandidateRow, mergedAway: string[]): Promise<boolean> {
    const older = await findOlderDuplicate(ctx.userId, row, {
      maxDistance: 1 - MERGE_MIN_COSINE,
      excludeTypes: MERGE_EXCLUDED_TYPES,
      excludeIds: [...mergedAway],
    })
    if (!older) return false

    const nowIso = ctx.now.toISOString()
    const op: MemoryOpInput = {
      memoryId: row.id,
      step: this.name,
      op: 'merge',
      before: {
        newer: { id: row.id, supersededAt: null, supersededById: null },
        older: { id: older.id, useCount: older.useCount, lastUsedAt: older.lastUsedAt?.toISOString() ?? null },
      },
      after: {
        newer: { id: row.id, supersededAt: nowIso, supersededById: older.id },
        older: { id: older.id, useCount: older.useCount + 1, lastUsedAt: nowIso },
      },
      reason: `repeat of older ${older.id} (cosine ${older.similarity.toFixed(3)} ≥ ${MERGE_MIN_COSINE})`,
    }
    if (ctx.dryRun) ctx.changes.record(op)
    else if (!(await applyMerge(ctx.userId, row.id, older.id, ctx.now, { runId: ctx.runId, ops: [op] }))) return false

    mergedAway.push(row.id)
    return true
  }
}
