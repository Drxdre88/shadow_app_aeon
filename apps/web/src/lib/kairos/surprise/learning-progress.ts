import type { KairosPrediction } from '@/lib/data/validators/kairos-predictions'
import { SURPRISE_MAX_LP_AREAS, type SurpriseLp, type SurpriseLpArea } from '@/lib/data/validators/kairos-surprise'
import { curiosityLpMode } from './flag'

// Learning-progress curiosity (spec_surprise lane 2). Per area (a Dominion,
// else 'topic:<topic>') take the last ≤10 settled right/wrong predictions,
// oldest → newest, split them in halves (each ≥3): LP = Brier(older) −
// Brier(newer) — positive when Kairos is getting better at calling the area.
// Halved when the newest settlement is >30 days old. Interest = max(0, LP).
// Fewer than 6 → no LP (no bias). The pure metric is here, plus a reader that
// stores the result in the surprise ledger (`lp`). Behind KAIROS_CURIOSITY_LP.

export const LP_WINDOW = 10
export const LP_MIN_N = 6
export const LP_MIN_HALF = 3
export const LP_STALE_MS = 30 * 86_400_000
export const LP_PROMPT_TOP = 3
export const LP_BIAS_WEIGHT = 0.15

type Settled = Pick<KairosPrediction, 'dominionId' | 'topic' | 'probability' | 'status' | 'settledAt' | 'createdAt'>

export const lpAreaKey = (p: Pick<KairosPrediction, 'dominionId' | 'topic'>) => p.dominionId ?? `topic:${p.topic}`

const round3 = (n: number) => Math.round(n * 1000) / 1000
const at = (p: Settled) => Date.parse(p.settledAt ?? p.createdAt)
const brier = (items: readonly Settled[]) =>
  items.reduce((sum, p) => sum + (p.probability - (p.status === 'right' ? 1 : 0)) ** 2, 0) / items.length

// LP for one area's settled predictions (any order), or null when sparse.
export function areaLearningProgress(items: readonly Settled[], now: Date): Omit<SurpriseLpArea, 'key'> | null {
  const recent = items
    .filter((p) => (p.status === 'right' || p.status === 'wrong') && Number.isFinite(at(p)))
    .sort((a, b) => at(a) - at(b))
    .slice(-LP_WINDOW)
  if (recent.length < LP_MIN_N) return null
  const older = recent.slice(0, Math.floor(recent.length / 2))
  const newer = recent.slice(older.length)
  if (older.length < LP_MIN_HALF || newer.length < LP_MIN_HALF) return null
  const brierNew = brier(newer)
  let lp = brier(older) - brierNew
  if (now.getTime() - at(recent[recent.length - 1]!) > LP_STALE_MS) lp *= 0.5
  return { lp: round3(lp), brierNew: round3(brierNew), nNew: newer.length, nOld: older.length }
}

// Every area with enough history, highest LP first.
export function computeLearningProgress(closed: readonly Settled[], now: Date): SurpriseLp {
  const groups = new Map<string, Settled[]>()
  for (const p of closed) groups.set(lpAreaKey(p), [...(groups.get(lpAreaKey(p)) ?? []), p])
  const areas: SurpriseLpArea[] = []
  for (const [key, items] of groups) {
    const lp = areaLearningProgress(items, now)
    if (lp) areas.push({ key, ...lp })
  }
  areas.sort((a, b) => b.lp - a.lp || a.key.localeCompare(b.key))
  return { computedAt: now.toISOString(), areas: areas.slice(0, SURPRISE_MAX_LP_AREAS) }
}

export const lpInterest = (area: Pick<SurpriseLpArea, 'lp'>) => Math.max(0, area.lp)

// The areas worth a question: interest > 0, highest first.
export function topLearningProgress(lp: SurpriseLp | null, k = LP_PROMPT_TOP): SurpriseLpArea[] {
  return (lp?.areas ?? []).filter((a) => lpInterest(a) > 0).sort((a, b) => lpInterest(b) - lpInterest(a)).slice(0, k)
}

// Interest normalised to [0,1] by the best area (empty when none is learning).
export function lpBiasMap(lp: SurpriseLp | null): Map<string, number> {
  const areas = topLearningProgress(lp, SURPRISE_MAX_LP_AREAS)
  const max = areas[0] ? lpInterest(areas[0]) : 0
  return new Map(max > 0 ? areas.map((a) => [a.key, lpInterest(a) / max]) : [])
}

// Recomputes LP from the prediction ledger and stores it in the surprise
// ledger. null when the flag is off or on any failure. Never throws.
export async function refreshLearningProgress(userId: string, now: Date = new Date()): Promise<SurpriseLp | null> {
  if (curiosityLpMode() === 'off') return null
  try {
    const { readKairosPredictions } = await import('@/lib/data/kairos-predictions')
    const lp = computeLearningProgress((await readKairosPredictions(userId)).closed, now)
    const { mutateKairosSurprise } = await import('@/lib/data/kairos-surprise')
    await mutateKairosSurprise(userId, (ledger) => ({ state: { ...ledger, lp }, result: null }), now)
    return lp
  } catch (err) {
    console.error('[kairos:surprise] refreshLearningProgress failed:', err)
    return null
  }
}

// ask_mine's view: recompute + store whenever the flag is not off; the prompt
// block only when 'on' (observe computes and stores, nothing else).
export async function learningProgressForAskMine(userId: string, now: Date): Promise<Array<Record<string, unknown>> | null> {
  if (curiosityLpMode() === 'off') return null
  const lp = await refreshLearningProgress(userId, now)
  if (curiosityLpMode() !== 'on') return null
  const top = topLearningProgress(lp)
  if (top.length === 0) return null
  return top.map((a) => ({
    ...(a.key.startsWith('topic:') ? { topic: a.key.slice(6) } : { dominionId: a.key }),
    learningProgress: a.lp,
    recentBrier: a.brierNew,
    settled: a.nNew + a.nOld,
  }))
}

// The selection bias for ask_mine (stored LP), only when the flag is 'on'.
export async function loadLpBias(userId: string): Promise<Map<string, number> | undefined> {
  if (curiosityLpMode() !== 'on') return undefined
  try {
    const { readKairosSurprise } = await import('@/lib/data/kairos-surprise')
    return lpBiasMap((await readKairosSurprise(userId)).lp)
  } catch (err) {
    console.error('[kairos:surprise] loadLpBias failed:', err)
    return undefined
  }
}
