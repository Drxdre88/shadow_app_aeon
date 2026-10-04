import type { LifeChapterMeta } from '@/lib/data/validators/kairos-life-chapters'

// Gathers one month's evidence for the life_chapter job. Allowed sources only
// (spec E): weekly reviews, belief changes, settled predictions, closed
// promises, goals, constitution versions, Aether at the start vs the end, and
// the previous chapter (his own words — context, never citable). Never
// conscience/drift, character, cold reads, dreams, the surprise ledger or the
// stage (life-chapters/__tests__/firewall.test.ts). Each source soft-fails;
// lib/data is imported lazily so loading the handler opens no DB module.

export const LIFE_CHAPTER_CAPS = {
  reviews: 6, beliefs: 20, predictions: 15, promises: 15, goals: 8, constitution: 3,
} as const
export const LIFE_CHAPTER_MIN_CITABLE = 3

export interface ChapterWindow { month: string; start: Date; end: Date }

export interface LifeChapterInputs {
  month: string
  reviews: Array<{ id: string; isoWeek: string; summary: string; wins: string[]; drift: string[] }>
  beliefs: Array<{ id: string; step: string; op: string; mind: string | null; claim: string; at: string }>
  predictions: Array<{ id: string; seq: number; claim: string; probability: number; status: string; settledAt: string }>
  promises: Array<{ id: string; seq: number; outcome: string; status: string; closedAt: string }>
  goals: Array<{ id: string; title: string; state: string; at: string }>
  constitution: Array<{ id: string; title: string; at: string }>
  aether: { start: { id: string; text: string } | null; end: { id: string; text: string } | null }
  previous: { month: string; title: string; summary: string; unresolved: string[] } | null
  errors: string[]
}

const inWindow = (iso: string | undefined, w: ChapterWindow) => {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t >= w.start.getTime() && t < w.end.getTime()
}

export async function gatherLifeChapterInputs(userId: string, w: ChapterWindow): Promise<LifeChapterInputs> {
  const errors: string[] = []
  const soft = async <T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run()
    } catch (err) {
      errors.push(label)
      console.warn(`[kairos:life-chapter] ${label} read failed:`, err instanceof Error ? err.message : String(err))
      return fallback
    }
  }
  const data = await import('@/lib/data/life-chapters')
  const [reviews, beliefs, predictions, promises, goals, constitution, aetherStart, aetherEnd, previous] = await Promise.all([
    soft('reviews', () => data.listWeeklyReviewsOverlapping(userId, w.start, w.end, LIFE_CHAPTER_CAPS.reviews), []),
    soft('beliefs', async () => {
      const { listBeliefDiffOps } = await import('@/lib/data/belief-diff')
      return listBeliefDiffOps(userId, w.start, w.end, 200)
    }, []),
    soft('predictions', async () => {
      const { readKairosPredictions } = await import('@/lib/data/kairos-predictions')
      return (await readKairosPredictions(userId)).closed
    }, []),
    soft('promises', async () => {
      const { readKairosPromises } = await import('@/lib/data/kairos-promises')
      return (await readKairosPromises(userId)).closed
    }, []),
    soft('goals', () => data.listGoalsTouchedBetween(userId, w.start, w.end, LIFE_CHAPTER_CAPS.goals), []),
    soft('constitution', () => data.listConstitutionVersionsBetween(userId, w.start, w.end, LIFE_CHAPTER_CAPS.constitution), []),
    soft('aether', () => data.findAetherNarrativeBefore(userId, w.start), null),
    soft('aether', () => data.findAetherNarrativeBefore(userId, w.end), null),
    soft('previous chapter', () => data.findLatestLifeChapterBefore(userId, w.month), null),
  ])

  const seenBeliefs = new Set<string>()
  const beliefRows: LifeChapterInputs['beliefs'] = []
  for (const b of beliefs) {
    if (!b.memoryId || seenBeliefs.has(b.memoryId) || beliefRows.length >= LIFE_CHAPTER_CAPS.beliefs) continue
    seenBeliefs.add(b.memoryId)
    beliefRows.push({ id: b.memoryId, step: b.step, op: b.op, mind: b.mind, claim: b.claim ?? '', at: b.createdAt.toISOString() })
  }
  const prev: LifeChapterMeta | null = previous?.chapter ?? null
  const shifted = aetherEnd && aetherEnd.id !== aetherStart?.id
  return {
    month: w.month,
    reviews,
    beliefs: beliefRows,
    predictions: predictions
      .filter((p) => inWindow(p.settledAt, w))
      .slice(0, LIFE_CHAPTER_CAPS.predictions)
      .map((p) => ({ id: p.id, seq: p.seq, claim: p.claim, probability: p.probability, status: p.status, settledAt: p.settledAt ?? '' })),
    promises: promises
      .filter((p) => inWindow(p.closedAt, w))
      .slice(0, LIFE_CHAPTER_CAPS.promises)
      .map((p) => ({ id: p.id, seq: p.seq, outcome: p.outcome, status: p.status, closedAt: p.closedAt ?? '' })),
    goals,
    constitution: constitution.map((c) => ({ id: c.id, title: c.title, at: c.at.toISOString() })),
    aether: shifted
      ? { start: aetherStart ? { id: aetherStart.id, text: aetherStart.narrative } : null, end: { id: aetherEnd.id, text: aetherEnd.narrative } }
      : { start: null, end: null },
    previous: prev ? { month: prev.month, title: prev.title, summary: prev.summary, unresolved: prev.unresolved } : null,
    errors: [...new Set(errors)],
  }
}

// Ids the chapter may cite (memory ids plus prediction / promise UUIDs). The
// previous chapter is never citable.
export function citableIds(i: LifeChapterInputs): string[] {
  return [...new Set([
    ...i.reviews.map((r) => r.id),
    ...i.beliefs.map((b) => b.id),
    ...i.predictions.map((p) => p.id),
    ...i.promises.map((p) => p.id),
    ...i.goals.map((g) => g.id),
    ...i.constitution.map((c) => c.id),
    ...(i.aether.start ? [i.aether.start.id] : []),
    ...(i.aether.end ? [i.aether.end.id] : []),
  ])]
}

// Enough happened to write about: ≥3 citable ids not counting Aether (which
// exists every month and is not an event of his).
export function hasChapterSignal(i: LifeChapterInputs): boolean {
  const aetherIds = new Set([i.aether.start?.id, i.aether.end?.id].filter(Boolean))
  return citableIds(i).filter((id) => !aetherIds.has(id)).length >= LIFE_CHAPTER_MIN_CITABLE
}

export function inputCounts(i: LifeChapterInputs): Record<string, number> {
  return {
    reviews: i.reviews.length,
    beliefs: i.beliefs.length,
    predictions: i.predictions.length,
    promises: i.promises.length,
    goals: i.goals.length,
    constitution: i.constitution.length,
    aether: (i.aether.start ? 1 : 0) + (i.aether.end ? 1 : 0),
    previous: i.previous ? 1 : 0,
  }
}
