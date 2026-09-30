import {
  applyMerge,
  findOlderDuplicate,
  listMergeCandidates,
} from '@/lib/data/memory-candidates'
import type { EngineRunContext, Step, StepResult } from '../types'
import { isVetoed } from './back-up'

// Gate/Merge (docs/kairos/32 §2.1). A new row that is a near-verbatim repeat
// (cosine ≥ 0.95) of an OLDER live row of the same stream class is folded in
// as a reinforcement: the newer is superseded by the older (valid time kept —
// it is a repeat, not a correction) and the older gets useCount+1 /
// lastUsedAt=now. Never for reflections, pinned rows, synthesised documents
// (concept/cortex/aether/archetype) or inbox/ask rows with their own lifecycle.

export const MERGE_MIN_COSINE = 0.95
export const MERGE_WINDOW_HOURS = 36
export const MERGE_CANDIDATE_CAP = 200

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
] as const

export const MERGE_EXCLUDED_STREAMS = ['reflection', 'concept', 'cortex', 'aether', 'archetype'] as const

export class MergeStep implements Step {
  readonly name = 'merge'

  constructor(private readonly opts: { cap?: number } = {}) {}

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
    let changed = 0
    for (const row of rows) {
      if (isVetoed(row.sourceMetadata, 'merge')) continue
      const older = await findOlderDuplicate(ctx.userId, row, {
        maxDistance: 1 - MERGE_MIN_COSINE,
        excludeTypes: MERGE_EXCLUDED_TYPES,
        excludeIds: [...mergedAway],
      })
      if (!older) continue
      if (!ctx.dryRun && !(await applyMerge(ctx.userId, row.id, older.id, ctx.now))) continue

      mergedAway.push(row.id)
      changed++
      const nowIso = ctx.now.toISOString()
      ctx.changes.record({
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
      })
    }
    return { step: this.name, examined: rows.length, changed }
  }
}
