import { CONFIDENCE_BY_STREAM } from '@/lib/kairos/confidence'
import {
  findProposalSupports,
  listPendingProposalCandidates,
  updatePendingProposal,
  type ProposalCandidateRow,
  type SupportRow,
} from '@/lib/data/memory-candidates'
import type { EngineRunContext, MemoryOpInput, Step, StepResult, SupportSummary } from '../types'

// BackUp — the candidate tier (docs/kairos/32 §2.3). Kairos's own pending
// introspection proposals are guesses until the operator's world backs them
// up: ≥ 2 independent supports on ≥ 2 distinct UTC days promote a proposal to
// an 'idea' ("I now believe X", vetoable by reverting the op); one that finds
// no backing within 21 days decays (archived). Contradiction notices are
// verdicts for the operator and are never candidates.

export const SUPPORT_MIN_COSINE = 0.8
export const PROMOTE_MIN_SUPPORTS = 2
export const PROMOTE_MIN_DAYS = 2
export const CANDIDATE_TTL_DAYS = 21
export const BACKUP_CANDIDATE_CAP = 400

const DAY_MS = 86_400_000
const SELF_SOURCES = new Set(['cron', 'system'])
// Machine-written pages that still reflect operator activity (a Hangar mission
// the operator ran, the board's day/week page) count as independent evidence.
const OPERATOR_ACTIVITY_KINDS = new Set(['hangar_mission', 'board_day', 'board_week'])

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function sessionKey(meta: Record<string, unknown>): string | null {
  const session = asRecord(meta.session)
  for (const v of [session.sessionId, meta.sessionId, session.hangarSessionId]) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function citesProposal(row: SupportRow, proposalId: string): boolean {
  if (row.links.some((l) => l?.target === proposalId)) return true
  const citations = row.sourceMetadata.citations
  return Array.isArray(citations) && citations.includes(proposalId)
}

function isSelfWritten(row: SupportRow): boolean {
  if (!SELF_SOURCES.has(row.source)) return false
  const kind = row.sourceMetadata.kind
  return !(typeof kind === 'string' && OPERATOR_ACTIVITY_KINDS.has(kind))
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10)

// Independence (§2.3): drop Kairos's own writes, rows citing the proposal, and
// collapse one session's rows to a single support dated by its earliest row.
export function summariseSupport(proposalId: string, rows: readonly SupportRow[]): SupportSummary {
  const bySession = new Map<string, Date>()
  const days = new Set<string>()
  let independent = 0
  for (const row of rows) {
    if (row.id === proposalId || isSelfWritten(row) || citesProposal(row, proposalId)) continue
    const key = sessionKey(row.sourceMetadata)
    if (key === null) {
      independent++
      days.add(utcDay(row.createdAt))
      continue
    }
    const seen = bySession.get(key)
    if (!seen || row.createdAt < seen) bySession.set(key, row.createdAt)
  }
  for (const at of bySession.values()) {
    independent++
    days.add(utcDay(at))
  }
  return { independentSupports: independent, distinctDays: days.size }
}

export function shouldPromote(s: SupportSummary): boolean {
  return s.independentSupports >= PROMOTE_MIN_SUPPORTS && s.distinctDays >= PROMOTE_MIN_DAYS
}

function sameSupport(a: unknown, b: SupportSummary): boolean {
  const r = asRecord(a)
  return r.independentSupports === b.independentSupports && r.distinctDays === b.distinctDays
}

// dryRun: log only. Live: write first and log only what actually landed (the
// pending guard can lose to an operator accept/dismiss mid-run).
async function commit(ctx: EngineRunContext, op: MemoryOpInput, write: () => Promise<boolean>): Promise<boolean> {
  if (!ctx.dryRun && !(await write())) return false
  ctx.changes.record(op)
  return true
}

// A reverted promote/decay/merge leaves engine.vetoes[op] (docs/kairos/32 §4a);
// the legacy single-slot engine.veto = { op } is still honoured.
export function isVetoed(meta: Record<string, unknown>, op: string): boolean {
  const engine = asRecord(meta.engine)
  return asRecord(engine.vetoes)[op] != null || asRecord(engine.veto).op === op
}

export class BackUpStep implements Step {
  readonly name = 'backup'

  constructor(private readonly opts: { cap?: number } = {}) {}

  async run(ctx: EngineRunContext): Promise<StepResult> {
    const candidates = await listPendingProposalCandidates(ctx.userId, this.opts.cap ?? BACKUP_CANDIDATE_CAP)
    let changed = 0
    let promoted = 0
    let decayed = 0
    for (const c of candidates) {
      const outcome = await this.weighCandidate(ctx, c)
      if (outcome === 'promote') promoted++
      if (outcome === 'decay') decayed++
      if (outcome !== 'none') changed++
    }
    return {
      step: this.name,
      examined: candidates.length,
      changed,
      notes: [`promoted=${promoted}`, `decayed=${decayed}`],
    }
  }

  private async weighCandidate(
    ctx: EngineRunContext,
    c: ProposalCandidateRow,
  ): Promise<'promote' | 'decay' | 'support' | 'none'> {
    const supports = c.hasEmbedding
      ? await findProposalSupports(ctx.userId, c.id, c.createdAt, 1 - SUPPORT_MIN_COSINE)
      : []
    const support = summariseSupport(c.id, supports)
    const meta = c.sourceMetadata
    const engine = { ...asRecord(meta.engine), support }
    const nowIso = ctx.now.toISOString()

    // A vetoed promotion stays a pending guess — the same evidence must not
    // re-promote it the next night.
    if (shouldPromote(support) && !isVetoed(meta, 'promote')) {
      const confidence = CONFIDENCE_BY_STREAM.idea
      const done = await commit(ctx, {
        memoryId: c.id,
        step: this.name,
        op: 'promote',
        before: { status: 'pending', streamClass: c.streamClass, confidence: c.confidence },
        after: { status: 'promoted', streamClass: 'idea', confidence },
        reason: `I now believe "${c.title}" — ${support.independentSupports} independent supports on ${support.distinctDays} days`,
      }, () => updatePendingProposal(ctx.userId, c.id, {
        sourceMetadata: { ...meta, status: 'promoted', promotedAt: nowIso, engine },
        streamClass: 'idea',
        confidence,
        updatedAt: ctx.now,
      }))
      return done ? 'promote' : 'none'
    }

    const ageDays = (ctx.now.getTime() - c.createdAt.getTime()) / DAY_MS
    if (ageDays > CANDIDATE_TTL_DAYS && !isVetoed(meta, 'decay')) {
      const done = await commit(ctx, {
        memoryId: c.id,
        step: this.name,
        op: 'decay',
        before: { status: 'pending', archivedAt: null },
        after: { status: 'decayed', archivedAt: nowIso },
        reason: `no independent backing after ${Math.floor(ageDays)} days (${support.independentSupports} supports, ${support.distinctDays} days)`,
      }, () => updatePendingProposal(ctx.userId, c.id, {
        sourceMetadata: { ...meta, status: 'decayed', engine },
        archivedAt: ctx.now,
        updatedAt: ctx.now,
      }))
      return done ? 'decay' : 'none'
    }

    if (sameSupport(asRecord(meta.engine).support, support)) return 'none'
    if (!ctx.dryRun) await updatePendingProposal(ctx.userId, c.id, { sourceMetadata: { ...meta, engine } })
    return 'support'
  }
}
