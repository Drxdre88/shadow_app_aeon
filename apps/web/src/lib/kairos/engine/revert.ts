import { findMemoryOp } from '@/lib/data/memory-ops'
import {
  applyMemoryOpRevert,
  findRevertableMemories,
  MemoryOpRevertRaceError,
  type MemoryRestorePatch,
  type RevertableMemoryRow,
} from '@/lib/data/memory-candidates'

// revertMemoryOp (docs/kairos/32 §2.5) — the operator's veto. Restores the
// op's `before` snapshot onto the memory (both rows for a merge; the full
// content for a concept_update; the counters for an outcome reaction), logs a
// 'revert' op and stamps the original reverted, atomically. A reverted
// promote/decay/merge also leaves `sourceMetadata.engine.vetoes[op]` on the
// memory so the next night's engine run does not simply redo it. A revert
// that would change nothing is refused as not_revertable.

export type RevertMemoryOpResult =
  | { ok: true; opId: string; revertOpId: string; restoredMemoryIds: string[] }
  | { ok: false; reason: 'not_found' | 'already_reverted' | 'not_revertable' | 'memory_missing' | 'stale' }

const DATE_KEYS = ['standingAt', 'archivedAt', 'supersededAt', 'invalidAt', 'lastUsedAt'] as const
const PLAIN_KEYS = ['streamClass', 'confidence', 'standing', 'supersededById'] as const
// Counters that later activity legitimately moves; never a staleness signal.
const ACTIVITY_KEYS = new Set(['useCount', 'lastUsedAt'])
const VETO_OPS = new Set(['promote', 'decay', 'merge'])
const NOT_REVERTABLE = new Set(['revert', 'concept_create'])
// lib/data/concepts.ts snapshot() fields — a concept_update's before/after.
const CONCEPT_CONTENT_KEYS = ['title', 'bodyMd', 'summary', 'confidence', 'links', 'tags', 'sourceMetadata'] as const
// Scalar content keys cheap to compare exactly for the staleness check.
const CONCEPT_STALE_KEYS = ['title', 'bodyMd', 'summary', 'confidence'] as const

type Snapshot = Record<string, unknown>

interface RestorePlan {
  memoryId: string
  before: Snapshot
  after: Snapshot
}

function asRecord(v: unknown): Snapshot | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Snapshot) : null
}

function comparable(key: string, v: unknown): unknown {
  if (v == null) return null
  if ((DATE_KEYS as readonly string[]).includes(key)) {
    const t = new Date(v as string | Date).getTime()
    return Number.isFinite(t) ? t : v
  }
  return v
}

function same(key: string, a: unknown, b: unknown): boolean {
  const x = comparable(key, a)
  const y = comparable(key, b)
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) < 1e-6
  return x === y
}

function currentValue(row: RevertableMemoryRow, key: string): unknown {
  if (key === 'status') return row.sourceMetadata.status
  return (row as unknown as Record<string, unknown>)[key]
}

function plansFor(op: { op: string; memoryId: string | null; before: unknown; after: unknown }): RestorePlan[] | null {
  const before = asRecord(op.before)
  const after = asRecord(op.after) ?? {}
  if (!before || NOT_REVERTABLE.has(op.op)) return null
  if (op.op !== 'merge') {
    return op.memoryId ? [{ memoryId: op.memoryId, before, after }] : null
  }
  const newerBefore = asRecord(before.newer)
  const olderBefore = asRecord(before.older)
  const newerAfter = asRecord(after.newer) ?? {}
  const olderAfter = asRecord(after.older) ?? {}
  const newerId = (newerBefore?.id as string | undefined) ?? op.memoryId
  const olderId = (olderBefore?.id as string | undefined) ?? (newerAfter.supersededById as string | undefined)
  if (!newerBefore || !olderBefore || !newerId || !olderId) return null
  return [
    { memoryId: newerId, before: newerBefore, after: newerAfter },
    { memoryId: olderId, before: olderBefore, after: olderAfter },
  ]
}

interface VetoStamp {
  op: string
  opId: string
  at: string
}

function buildPatch(
  plan: RestorePlan,
  row: RevertableMemoryRow,
  veto: VetoStamp | null,
  opKind: string,
): MemoryRestorePatch | 'stale' {
  if (opKind === 'concept_update') return buildConceptPatch(plan, row)
  if (opKind === 'feedback' && asRecord(plan.before.outcome)) return buildOutcomePatch(plan)

  for (const [key, value] of Object.entries(plan.after)) {
    if (key === 'id' || ACTIVITY_KEYS.has(key)) continue
    if (key !== 'status' && !(DATE_KEYS as readonly string[]).includes(key) && !(PLAIN_KEYS as readonly string[]).includes(key)) continue
    if (!same(key, currentValue(row, key), value)) return 'stale'
  }

  const set: MemoryRestorePatch['set'] = {}
  let decrementUseCount = false
  for (const key of PLAIN_KEYS) {
    if (key in plan.before) (set as Record<string, unknown>)[key] = plan.before[key] ?? null
  }
  for (const key of DATE_KEYS) {
    if (!(key in plan.before)) continue
    // Activity since the op wins: only rewind lastUsedAt if nothing touched it.
    if (key === 'lastUsedAt' && !same(key, row.lastUsedAt, plan.after.lastUsedAt)) continue
    const v = plan.before[key]
    ;(set as Record<string, unknown>)[key] = v == null ? null : new Date(v as string)
  }
  if (typeof plan.before.useCount === 'number') {
    const afterCount = plan.after.useCount
    if (row.useCount === afterCount) set.useCount = plan.before.useCount
    else if (typeof afterCount === 'number' && afterCount - plan.before.useCount === 1) decrementUseCount = true
  }

  const meta: Snapshot = { ...row.sourceMetadata }
  let metaChanged = false
  if ('status' in plan.before) {
    meta.status = plan.before.status
    metaChanged = true
  }
  if (opKind === 'promote' && 'promotedAt' in meta) {
    delete meta.promotedAt
    metaChanged = true
  }
  if (veto) {
    // One slot per op kind, so vetoing a decay never erases a promote veto.
    // A legacy single `engine.veto` is left as-is (readers still honour it).
    const engine = asRecord(meta.engine) ?? {}
    const vetoes = { ...(asRecord(engine.vetoes) ?? {}), [veto.op]: { opId: veto.opId, at: veto.at } }
    const nextEngine: Snapshot = { ...engine, vetoes }
    // The undone op's own stamp goes with it; another op's stamp stays.
    if (veto.op === 'promote') delete nextEngine.promotedAt
    if (veto.op === 'decay') delete nextEngine.decayedAt
    meta.engine = nextEngine
    metaChanged = true
  }
  if (metaChanged) set.sourceMetadata = meta

  return { memoryId: plan.memoryId, set, ...(decrementUseCount ? { decrementUseCount } : {}) }
}

// concept_update: restore the full concept snapshot (concepts.ts snapshot())
// and re-null the embedding so the restored body re-embeds. Stale when the
// concept's content moved on since the update (e.g. a later week rewrote it).
function buildConceptPatch(plan: RestorePlan, row: RevertableMemoryRow): MemoryRestorePatch | 'stale' {
  for (const key of CONCEPT_STALE_KEYS) {
    if (key in plan.after && !same(key, currentValue(row, key), plan.after[key])) return 'stale'
  }
  const set: MemoryRestorePatch['set'] = {}
  const target = set as Record<string, unknown>
  for (const key of CONCEPT_CONTENT_KEYS) {
    if (key in plan.before) target[key] = plan.before[key] ?? null
  }
  if (typeof set.title !== 'string' || typeof set.bodyMd !== 'string') return { memoryId: plan.memoryId, set: {} }
  if (set.links === null) set.links = []
  if (set.tags === null) set.tags = []
  if (set.sourceMetadata === null) set.sourceMetadata = {}
  set.embedding = null
  set.embeddingModel = null
  return { memoryId: plan.memoryId, set }
}

// Outcome reaction: subtract exactly what the op added, relative to the
// current counters (later reactions survive), via the atomic SQL merge.
function buildOutcomePatch(plan: RestorePlan): MemoryRestorePatch {
  const before = asRecord(plan.before.outcome) ?? {}
  const after = asRecord(plan.after.outcome) ?? {}
  const delta = (k: 'positive' | 'negative') => {
    const d = (Number(before[k]) || 0) - (Number(after[k]) || 0)
    return Number.isFinite(d) ? Math.trunc(d) : 0
  }
  const outcomeDelta = { positive: delta('positive'), negative: delta('negative') }
  if (outcomeDelta.positive === 0 && outcomeDelta.negative === 0) return { memoryId: plan.memoryId, set: {} }
  return { memoryId: plan.memoryId, set: {}, outcomeDelta }
}

function isNoOp(p: MemoryRestorePatch): boolean {
  return Object.keys(p.set).length === 0 && !p.decrementUseCount && !p.outcomeDelta
}

export async function revertMemoryOp(
  userId: string,
  opId: string,
  opts: { reason?: string; now?: Date } = {},
): Promise<RevertMemoryOpResult> {
  const op = await findMemoryOp(userId, opId)
  if (!op) return { ok: false, reason: 'not_found' }
  if (op.revertedAt) return { ok: false, reason: 'already_reverted' }

  const plans = plansFor(op)
  if (!plans) return { ok: false, reason: 'not_revertable' }

  const rows = await findRevertableMemories(userId, plans.map((p) => p.memoryId))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const now = opts.now ?? new Date()
  const veto: VetoStamp | null = VETO_OPS.has(op.op) ? { op: op.op, opId: op.id, at: now.toISOString() } : null

  const patches: MemoryRestorePatch[] = []
  for (const [i, plan] of plans.entries()) {
    const row = byId.get(plan.memoryId)
    if (!row) return { ok: false, reason: 'memory_missing' }
    // The veto marker lives on the primary row (the promoted/decayed proposal,
    // or the newer half of a merge) — the one the engine would redo.
    const patch = buildPatch(plan, row, i === 0 ? veto : null, op.op)
    if (patch === 'stale') return { ok: false, reason: 'stale' }
    patches.push(patch)
  }
  // Never report ok for a restore that would change nothing.
  if (patches.every(isNoOp)) return { ok: false, reason: 'not_revertable' }

  try {
    const revertOpId = await applyMemoryOpRevert(userId, op.id, patches, {
      memoryId: op.memoryId,
      step: 'revert',
      op: 'revert',
      before: asRecord(op.after),
      after: asRecord(op.before),
      reason: `revert ${op.op} ${op.id}${opts.reason ? `: ${opts.reason}` : ''}`,
    })
    return { ok: true, opId: op.id, revertOpId, restoredMemoryIds: patches.map((p) => p.memoryId) }
  } catch (err) {
    if (err instanceof MemoryOpRevertRaceError) return { ok: false, reason: 'already_reverted' }
    throw err
  }
}
