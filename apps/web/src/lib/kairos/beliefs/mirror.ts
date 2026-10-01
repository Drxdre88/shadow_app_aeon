import {
  listMirrorsOfRevertedPromotions,
  listUnmirroredPromotions,
  retireOwnBelief,
  writeOwnMirror,
  type PromotionToMirror,
} from '@/lib/data/beliefs'
import { CONFIDENCE_BY_STREAM } from '@/lib/kairos/confidence'
import { capBeliefConfidence } from '@/lib/kairos/origin'
import type { MemoryOpInput } from '@/lib/kairos/engine/types'
import { BELIEF_STEP, GENERAL_DOMAIN, OWN_UNKNOWN_FALSIFIER, beliefRowValues, oneLine, type BeliefV1 } from './types'

// Own mind (docs/kairos/34 §1): every engine promotion (BackUp "I now believe
// X", docs/kairos/32 §2.3) becomes a held own belief, sourceType 'inference'.
// No model. Idempotent per proposal (sourceMetadata.mirroredFrom); a promotion
// the operator later reverts retires its mirror (the operator's veto). Runs
// nightly as the memory engine's OwnMindStep, right after BackUp.

const MAX_REASONS = 3
const REASON_MAX = 240
const CLAIM_MAX = 300

function reasonsFromBody(body: string, claim: string): string[] {
  const text = body
    .split('\n')
    .map((l) => l.replace(/^([#>*\-`]+\s*)+/, '').trim())
    .filter((l) => l.length > 0 && !/^sources?:/i.test(l))
    .join(' ')
  const sentences = oneLine(text)
    .replace(/\s*\[[^\]]*\]/g, '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3 && s !== claim && !/^sources?:/i.test(s))
  return sentences.slice(0, MAX_REASONS).map((s) => (s.length > REASON_MAX ? `${s.slice(0, REASON_MAX - 1).trimEnd()}…` : s))
}

function citationsOf(meta: Record<string, unknown>): string[] {
  const raw = meta.citations
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

export function ownBeliefFromPromotion(p: PromotionToMirror): BeliefV1 {
  const claim = oneLine(p.aiTitle || p.title || p.summary || 'Untitled promotion').slice(0, CLAIM_MAX)
  const raw = typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1
    ? p.confidence
    : CONFIDENCE_BY_STREAM.idea
  // Kairos's own view is inference: capped like any inference-sourced belief.
  const confidence = capBeliefConfidence(raw, 'inference')
  return {
    v: 1,
    mind: 'own',
    domain: p.dominionId && p.dominionName ? p.dominionName : GENERAL_DOMAIN,
    dominionId: p.dominionId && p.dominionName ? p.dominionId : null,
    claim,
    reasons: reasonsFromBody(p.bodyMd || p.summary || '', claim),
    falsifier: OWN_UNKNOWN_FALSIFIER,
    sourceType: 'inference',
    provenance: [...new Set([p.proposalId, ...citationsOf(p.sourceMetadata)])],
    status: 'held',
    confidence,
  }
}

export interface MirrorOptions {
  // Engine run the ops belong to (memory_ops.run_id).
  runId?: string | null
  now?: Date
  // Checked before each write; true stops the pass (the rest carries over to
  // the next night — the lookback window re-scans it).
  stop?: () => boolean
  // Report the ops that would be written; write nothing.
  dryRun?: boolean
}

export interface MirrorResult {
  mirrored: string[]
  retired: string[]
  errors: string[]
  // Promotions + reverted mirrors found.
  examined: number
  // Dry run only: the ops a live pass would write.
  planned: MemoryOpInput[]
  stopped: boolean
}

export async function mirrorPromotionsToOwnMind(userId: string, since: Date, opts: MirrorOptions = {}): Promise<MirrorResult> {
  const now = opts.now ?? new Date()
  const runId = opts.runId ?? null
  const result: MirrorResult = { mirrored: [], retired: [], errors: [], examined: 0, planned: [], stopped: false }
  const promotions = await listUnmirroredPromotions(userId, since)
  const reverted = await listMirrorsOfRevertedPromotions(userId)
  result.examined = promotions.length + reverted.length
  for (const p of promotions) {
    if (opts.stop?.()) {
      result.stopped = true
      return result
    }
    try {
      const belief = ownBeliefFromPromotion(p)
      const reason = `own mind: engine promoted "${belief.claim}"`
      if (opts.dryRun) {
        result.planned.push({ memoryId: null, step: BELIEF_STEP, op: 'promote', before: null, after: { mind: 'own', mirroredFrom: p.proposalId, sourceOpId: p.opId }, reason })
        continue
      }
      const res = await writeOwnMirror(userId, beliefRowValues(belief), { proposalId: p.proposalId, sourceOpId: p.opId, reason, runId })
      if (res.written) result.mirrored.push(res.memoryId)
    } catch (err) {
      result.errors.push(`${p.proposalId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  for (const m of reverted) {
    if (opts.stop?.()) {
      result.stopped = true
      return result
    }
    const reason = `own mind: source promotion ${m.opId} was reverted`
    if (opts.dryRun) {
      result.planned.push({ memoryId: m.beliefId, step: BELIEF_STEP, op: 'decay', before: null, after: { beliefId: m.beliefId, mind: 'own', status: 'retired' }, reason })
      continue
    }
    try {
      if (await retireOwnBelief(userId, m.beliefId, reason, now, runId)) result.retired.push(m.beliefId)
    } catch (err) {
      result.errors.push(`${m.beliefId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}
