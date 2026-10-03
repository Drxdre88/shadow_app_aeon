import {
  listCollisionCandidates,
  listRecentCollisionPairKeys,
  readLatestAetherEmbedding,
} from '@/lib/data/idea-bridges'
import { dataLine } from '@/lib/kairos/ideas/prompt-data'
import { pickCollisionPairs } from './pick'
import { COLLISION_RECENT_DAYS, COLLISION_TEXT_CAP, type CollisionContext, type CollisionPair } from './types'

// Plan-time collision gathering: load, pick, shape the job-context payload.
// Best-effort: a failed read lands in `errors`; candidates failing → null.

const reason = (name: string, err: unknown) =>
  `collision.${name}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200)

export async function gatherCollisions(
  userId: string,
  now: Date,
  day: string,
  dominions: ReadonlyArray<{ id: string; name: string }>,
  errors: string[],
  mode: 'observe' | 'on',
): Promise<CollisionContext | null> {
  const soft = async <T>(name: string, fallback: T, run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (err) {
      errors.push(reason(name, err))
      return fallback
    }
  }
  const [candidates, anchor, recent] = await Promise.all([
    soft('candidates', null, () => listCollisionCandidates(userId, day)),
    soft('anchor', null, () => readLatestAetherEmbedding(userId)),
    soft('recent', new Set<string>(), () => listRecentCollisionPairKeys(userId, now, COLLISION_RECENT_DAYS)),
  ])
  if (!candidates) return null
  const names = new Map(dominions.map((d) => [d.id, d.name]))
  const picked = pickCollisionPairs(candidates, anchor, { now, recentPairKeys: recent })
  const text = (c: { title: string; summary: string | null }) =>
    dataLine(c.summary?.trim() ? `${c.title} — ${c.summary}` : c.title, COLLISION_TEXT_CAP)
  const round3 = (n: number) => Math.round(n * 1000) / 1000
  const pairs: CollisionPair[] = picked.pairs.map((p, i) => ({
    id: `p${i + 1}`,
    pairKey: p.pairKey,
    aId: p.a.id,
    bId: p.b.id,
    aArea: (p.a.dominionId && names.get(p.a.dominionId)) || null,
    bArea: (p.b.dominionId && names.get(p.b.dominionId)) || null,
    aDate: p.a.createdAt.toISOString().slice(0, 10),
    bDate: p.b.createdAt.toISOString().slice(0, 10),
    aText: text(p.a),
    bText: text(p.b),
    cos: round3(p.cos),
    relevance: round3(p.relevance),
    score: round3(p.score),
  }))
  return { v: 1, mode, anchor: picked.anchor, considered: picked.considered, pairs }
}
