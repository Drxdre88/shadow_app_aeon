import { CONFIDENCE_BY_STREAM } from '@/lib/kairos/confidence'
import { originKindOf, type OriginKind } from '@/lib/kairos/origin'
import {
  findProposalSupports,
  listPendingProposalCandidates,
  updatePendingProposal,
  updatePendingProposals,
  type ProposalCandidateRow,
  type ProposalPatch,
  type SupportRow,
} from '@/lib/data/memory-candidates'
import type { OpLog } from '@/lib/data/memory-ops'
import { errorMessage, outOfTime } from '../deadline'
import type { EngineRunContext, MemoryOpInput, Step, StepResult, SupportSummary } from '../types'

// BackUp — the candidate tier (docs/kairos/32 §2.3). Kairos's own pending
// introspection proposals are guesses until the operator's world backs them
// up: ≥ 2 independent supports on ≥ 2 distinct UTC days, at least one of them
// anchored in the operator's own words or activity (P2.5), promote a proposal to
// an 'idea' ("I now believe X", vetoable by reverting the op); one that finds
// no backing within 21 days decays (archived). Contradiction notices are
// verdicts for the operator and are never candidates.

export const SUPPORT_MIN_COSINE = 0.8
export const PROMOTE_MIN_SUPPORTS = 2
export const PROMOTE_MIN_DAYS = 2
// P2.5 (G7): at least one support must be the operator's own words or their
// recorded activity — AI-written material alone can't back Kairos up.
export const PROMOTE_MIN_ANCHORED = 1
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

const ANCHOR_ORIGINS: ReadonlySet<OriginKind> = new Set(['operator', 'activity'])
const isAnchored = (row: SupportRow) => ANCHOR_ORIGINS.has(originKindOf(row))

// Independence (§2.3): drop Kairos's own writes, rows citing the proposal, and
// collapse one session to a single support dated by its earliest row.
// P2.5 (G7): a support is anchored when its origin is the operator or their
// recorded activity; a collapsed session is anchored if any of its rows is.
export function summariseSupport(proposalId: string, rows: readonly SupportRow[]): SupportSummary {
  const bySession = new Map<string, { at: Date; anchored: boolean }>()
  const days = new Set<string>()
  let independent = 0
  let anchored = 0
  for (const row of rows) {
    if (row.id === proposalId || isSelfWritten(row) || citesProposal(row, proposalId)) continue
    const rowAnchored = isAnchored(row)
    const key = sessionKey(row.sourceMetadata)
    if (key === null) {
      independent++
      if (rowAnchored) anchored++
      days.add(utcDay(row.createdAt))
      continue
    }
    const seen = bySession.get(key)
    if (!seen) bySession.set(key, { at: row.createdAt, anchored: rowAnchored })
    else bySession.set(key, { at: row.createdAt < seen.at ? row.createdAt : seen.at, anchored: seen.anchored || rowAnchored })
  }
  for (const s of bySession.values()) {
    independent++
    if (s.anchored) anchored++
    days.add(utcDay(s.at))
  }
  return { independentSupports: independent, distinctDays: days.size, anchoredSupports: anchored }
}

export function shouldPromote(s: SupportSummary): boolean {
  return s.independentSupports >= PROMOTE_MIN_SUPPORTS
    && s.distinctDays >= PROMOTE_MIN_DAYS
    && (s.anchoredSupports ?? 0) >= PROMOTE_MIN_ANCHORED
}

function sameSupport(a: unknown, b: SupportSummary): boolean {
  const r = asRecord(a)
  return r.independentSupports === b.independentSupports
    && r.distinctDays === b.distinctDays
    && r.anchoredSupports === b.anchoredSupports
}

type CandidateOutcome = 'promote' | 'decay' | 'support' | 'none'

interface CandidatePlan {
  outcome: Exclude<CandidateOutcome, 'none'>
  candidate: ProposalCandidateRow
  patch: ProposalPatch
  op?: MemoryOpInput
}

// Map with at most `limit` calls in flight; each item settles on its own.
async function settleLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const out: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = { ok: true, value: await fn(items[i]) }
      } catch (error) {
        out[i] = { ok: false, error }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker))
  return out
}

// A reverted promote/decay/merge leaves engine.vetoes[op] (docs/kairos/32 §4a);
// the legacy single-slot engine.veto = { op } is still honoured.
export function isVetoed(meta: Record<string, unknown>, op: string): boolean {
  const engine = asRecord(meta.engine)
  return asRecord(engine.vetoes)[op] != null || asRecord(engine.veto).op === op
}

export const BACKUP_CHUNK = 25
// Support searches in flight at once (each is its own short transaction on
// the pool, max 20 connections).
export const BACKUP_READ_CONCURRENCY = 5

export interface BackUpStepOptions {
  cap?: number
  chunk?: number
  concurrency?: number
  budgetMs?: number
}

export class BackUpStep implements Step {
  readonly name = 'backup'
  readonly budgetMs?: number

  constructor(private readonly opts: BackUpStepOptions = {}) {
    this.budgetMs = opts.budgetMs
  }

  // Chunks of candidates: their support searches run concurrently, then the
  // chunk's writes commit in ONE transaction with the ops of the rows that
  // landed. 2026-10-02: one support search + one write transaction per
  // candidate, in sequence, ran at ~0.9s each — the 400-row backlog needed ~6
  // minutes and stopped at 166.
  async run(ctx: EngineRunContext): Promise<StepResult> {
    const candidates = await listPendingProposalCandidates(ctx.userId, this.opts.cap ?? BACKUP_CANDIDATE_CAP)
    const chunkSize = Math.max(1, this.opts.chunk ?? BACKUP_CHUNK)
    const concurrency = this.opts.concurrency ?? BACKUP_READ_CONCURRENCY
    const tally = { promote: 0, decay: 0, support: 0 }
    let examined = 0
    let stopped = false
    const errors: string[] = []
    for (let i = 0; i < candidates.length; i += chunkSize) {
      if (outOfTime(ctx)) {
        stopped = true
        break
      }
      const chunk = candidates.slice(i, i + chunkSize)
      examined += chunk.length
      const found = await settleLimited(chunk, concurrency, (c) => (c.hasEmbedding
        ? findProposalSupports(ctx.userId, c.id, c.createdAt, 1 - SUPPORT_MIN_COSINE)
        : Promise.resolve([] as SupportRow[])))
      const plans: CandidatePlan[] = []
      chunk.forEach((c, k) => {
        const r = found[k]
        if (!r.ok) {
          errors.push(`${c.id}: ${errorMessage(r.error)}`)
          return
        }
        const plan = this.planCandidate(ctx, c, r.value)
        if (plan) plans.push(plan)
      })
      if (ctx.dryRun) {
        for (const p of plans) {
          if (p.op) ctx.changes.record(p.op)
          tally[p.outcome]++
        }
        continue
      }
      const { done, cut } = await this.write(ctx, plans, errors)
      for (const p of done) tally[p.outcome]++
      if (cut) {
        stopped = true
        break
      }
    }
    const notes = [`promoted=${tally.promote}`, `decayed=${tally.decay}`]
    if (errors.length) notes.push(`failed=${errors.length}`)
    if (stopped) notes.push(`out of time after ${examined}/${candidates.length}`)
    return {
      step: this.name,
      examined,
      changed: tally.promote + tally.decay + tally.support,
      notes,
      ...(ctx.dryRun ? {} : { opsWritten: tally.promote + tally.decay }),
      ...(errors.length ? { errors } : {}),
      ...(stopped ? { outOfTime: true } : {}),
    }
  }

  // One transaction for the chunk; only rows the pending guard let through (an
  // operator accept/dismiss mid-run wins) log their op. If the batch fails it
  // rolled back whole, and is retried one proposal per transaction so one bad
  // row can't sink the rest; that retry stops at the deadline (the rows it
  // didn't reach stay pending for the next night). Returns the plans that
  // landed, and whether the retry was cut short.
  private async write(
    ctx: EngineRunContext,
    plans: readonly CandidatePlan[],
    errors: string[],
  ): Promise<{ done: CandidatePlan[]; cut: boolean }> {
    if (plans.length === 0) return { done: [], cut: false }
    try {
      const landed = await updatePendingProposals(
        ctx.userId,
        plans.map((p) => ({ id: p.candidate.id, patch: p.patch, ops: p.op ? [p.op] : [] })),
        ctx.runId,
      )
      return { done: plans.filter((p) => landed.has(p.candidate.id)), cut: false }
    } catch {
      const done: CandidatePlan[] = []
      for (const p of plans) {
        if (outOfTime(ctx)) return { done, cut: true }
        try {
          const log: OpLog | undefined = p.op ? { runId: ctx.runId, ops: [p.op] } : undefined
          if (await updatePendingProposal(ctx.userId, p.candidate.id, p.patch, log)) done.push(p)
        } catch (err) {
          errors.push(`${p.candidate.id}: ${errorMessage(err)}`)
        }
      }
      return { done, cut: false }
    }
  }

  private planCandidate(ctx: EngineRunContext, c: ProposalCandidateRow, supports: readonly SupportRow[]): CandidatePlan | null {
    const support = summariseSupport(c.id, supports)
    const meta = c.sourceMetadata
    const engine = { ...asRecord(meta.engine), support }
    const nowIso = ctx.now.toISOString()

    // A vetoed promotion stays a pending guess — the same evidence must not
    // re-promote it the next night.
    if (shouldPromote(support) && !isVetoed(meta, 'promote')) {
      const confidence = CONFIDENCE_BY_STREAM.idea
      return {
        outcome: 'promote',
        candidate: c,
        op: {
          memoryId: c.id,
          step: this.name,
          op: 'promote',
          before: { status: 'pending', streamClass: c.streamClass, confidence: c.confidence },
          after: { status: 'promoted', streamClass: 'idea', confidence },
          reason: `I now believe "${c.title}" — ${support.independentSupports} independent supports on ${support.distinctDays} days`,
        },
        patch: {
          sourceMetadata: { ...meta, status: 'promoted', promotedAt: nowIso, engine: { ...engine, promotedAt: nowIso } },
          streamClass: 'idea',
          confidence,
          updatedAt: ctx.now,
        },
      }
    }

    const ageDays = (ctx.now.getTime() - c.createdAt.getTime()) / DAY_MS
    if (ageDays > CANDIDATE_TTL_DAYS && !isVetoed(meta, 'decay')) {
      return {
        outcome: 'decay',
        candidate: c,
        op: {
          memoryId: c.id,
          step: this.name,
          op: 'decay',
          before: { status: 'pending', archivedAt: null },
          after: { status: 'decayed', archivedAt: nowIso },
          reason: `no independent backing after ${Math.floor(ageDays)} days (${support.independentSupports} supports, ${support.distinctDays} days)`,
        },
        patch: {
          sourceMetadata: { ...meta, status: 'decayed', engine: { ...engine, decayedAt: nowIso } },
          archivedAt: ctx.now,
          updatedAt: ctx.now,
        },
      }
    }

    // Support progress is bookkeeping, not a status change — no op.
    if (sameSupport(asRecord(meta.engine).support, support)) return null
    return { outcome: 'support', candidate: c, patch: { sourceMetadata: { ...meta, engine } } }
  }
}
