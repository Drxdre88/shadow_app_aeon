import type { KairosSurpriseLedger, SurpriseEvent, SurpriseEventKind } from '@/lib/data/validators/kairos-surprise'
import { sanitiseStageText } from '@/lib/kairos/stage/normalise'
import type { AmbientCandidate, StageSource, StageTier } from '@/lib/kairos/stage/types'
import { surpriseStageOn } from './flag'

// ─────────────────────────────────────────────────────────────────────────
// Surprise → stage (spec_surprise Lane 3, KAIROS_SURPRISE_STAGE=1 and the
// stage not off). Ledger events become ambient stage facts keyed
// `surprise:<eventId>` so the stage's ambientSeen posts each one once. Only
// events with s ≥ .5 post; an aha always posts. Text never carries ids.
// The stage's ambient composer calls readSurpriseAmbient (one hook).
// ─────────────────────────────────────────────────────────────────────────

export const SURPRISE_AMBIENT_MIN_S = 0.5
export const SURPRISE_AMBIENT_WINDOW_MS = 24 * 3_600_000
export const SURPRISE_AMBIENT_MAX = 3

// An ambient fact from the ledger. Unlike the stage's own AmbientCandidate,
// source may be 'job' (contradiction / support loss / aha are the engine's
// own findings, posted on the deep tier).
export type SurpriseAmbientCandidate = Omit<AmbientCandidate, 'source'> & { source: StageSource }

interface Route {
  source: StageSource
  tier: StageTier
  importance: number
  goalRelevance: number
  need: number
}

const ROUTE: Record<SurpriseEventKind, Route> = {
  prediction_wrong: { source: 'prediction', tier: 'deep', importance: 0.6, goalRelevance: 0.4, need: 0.4 },
  prediction_right: { source: 'prediction', tier: 'deep', importance: 0.5, goalRelevance: 0.4, need: 0.3 },
  promise_kept: { source: 'promise', tier: 'deep', importance: 0.6, goalRelevance: 0.6, need: 0.4 },
  promise_lapsed: { source: 'promise', tier: 'deep', importance: 0.8, goalRelevance: 0.6, need: 0.8 },
  promise_dropped: { source: 'promise', tier: 'deep', importance: 0.6, goalRelevance: 0.5, need: 0.5 },
  owner_correction: { source: 'owner', tier: 'owner', importance: 0.8, goalRelevance: 0.5, need: 0.6 },
  contradiction: { source: 'job', tier: 'deep', importance: 0.6, goalRelevance: 0.4, need: 0.5 },
  support_lost: { source: 'job', tier: 'deep', importance: 0.5, goalRelevance: 0.3, need: 0.4 },
  aha: { source: 'job', tier: 'deep', importance: 0.6, goalRelevance: 0.4, need: 0.4 },
}

export interface SurpriseAmbientLookup {
  // predictionId → claim, promiseId → outcome (owner-visible text only).
  predictions?: ReadonlyMap<string, string>
  promises?: ReadonlyMap<string, string>
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

function textFor(e: SurpriseEvent, lookup: SurpriseAmbientLookup): string {
  const claim = e.refs.predictionId ? lookup.predictions?.get(e.refs.predictionId) : undefined
  const outcome = e.refs.promiseId ? lookup.promises?.get(e.refs.promiseId) : undefined
  const n = e.refs.beliefIds.length
  switch (e.kind) {
    case 'prediction_wrong': return claim ? `A prediction I was confident in was wrong: ${claim}` : 'A prediction I was confident in turned out wrong.'
    case 'prediction_right': return claim ? `A prediction came true: ${claim}` : 'A prediction came true.'
    case 'promise_kept': return outcome ? `A promise was kept: ${outcome}` : 'A promise was kept.'
    case 'promise_lapsed': return outcome ? `A promise lapsed: ${outcome}` : 'A promise lapsed without being kept.'
    case 'promise_dropped': return outcome ? `A promise was dropped: ${outcome}` : 'A promise was dropped.'
    case 'owner_correction': return 'The owner corrected something I believed.'
    case 'contradiction': return 'Two of my beliefs contradict each other.'
    case 'support_lost': return n > 1 ? `${n} of my beliefs lost the evidence they rested on.` : 'A belief of mine lost the evidence it rested on.'
    case 'aha': return n > 1 ? `Something clicked: one new memory supports ${n} ${plural(n, 'belief', 'beliefs')} at once.` : 'Something clicked: a new memory resolved a question I had open.'
  }
}

// Pure: recent, salient ledger events → ambient facts (newest first, ≤3).
export function buildSurpriseAmbient(
  ledger: Pick<KairosSurpriseLedger, 'events'>,
  now: Date,
  lookup: SurpriseAmbientLookup = {},
): SurpriseAmbientCandidate[] {
  const from = now.getTime() - SURPRISE_AMBIENT_WINDOW_MS
  const out: SurpriseAmbientCandidate[] = []
  const recent = ledger.events
    .filter((e) => {
      const t = Date.parse(e.at)
      return Number.isFinite(t) && t >= from && t <= now.getTime() && (e.kind === 'aha' || e.s >= SURPRISE_AMBIENT_MIN_S)
    })
    .sort((a, b) => b.at.localeCompare(a.at))
  for (const e of recent) {
    if (out.length >= SURPRISE_AMBIENT_MAX) break
    const text = sanitiseStageText(textFor(e, lookup))
    if (!text) continue
    const r = ROUTE[e.kind]
    out.push({
      key: `surprise:${e.id}`,
      kind: e.kind,
      source: r.source,
      tier: r.tier,
      text,
      importance: r.importance,
      surprise: e.s,
      goalRelevance: r.goalRelevance,
      need: r.need,
    })
  }
  return out
}

// I/O half for the stage's ambient composer. [] unless KAIROS_SURPRISE_STAGE
// is on (and the stage is not off); never throws. Claim / outcome text is
// looked up only when an event needs it.
export async function readSurpriseAmbient(userId: string, now: Date = new Date()): Promise<SurpriseAmbientCandidate[]> {
  if (!surpriseStageOn()) return []
  try {
    const { readKairosSurprise } = await import('@/lib/data/kairos-surprise')
    const ledger = await readKairosSurprise(userId)
    const candidates = buildSurpriseAmbient(ledger, now)
    if (candidates.length === 0) return []
    const wanted = ledger.events.filter((e) => candidates.some((c) => c.key === `surprise:${e.id}`))
    const lookup: SurpriseAmbientLookup = {}
    if (wanted.some((e) => e.refs.predictionId)) {
      const { readKairosPredictions } = await import('@/lib/data/kairos-predictions')
      const s = await readKairosPredictions(userId).catch(() => null)
      if (s) lookup.predictions = new Map([...s.open, ...s.closed].map((p) => [p.id, p.claim]))
    }
    if (wanted.some((e) => e.refs.promiseId)) {
      const { readKairosPromises } = await import('@/lib/data/kairos-promises')
      const s = await readKairosPromises(userId).catch(() => null)
      if (s) lookup.promises = new Map([...s.open, ...s.closed].map((p) => [p.id, p.outcome]))
    }
    return buildSurpriseAmbient(ledger, now, lookup)
  } catch (err) {
    console.error('[kairos:surprise] readSurpriseAmbient failed:', err)
    return []
  }
}
