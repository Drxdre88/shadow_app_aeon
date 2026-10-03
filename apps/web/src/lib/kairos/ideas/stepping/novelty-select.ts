import { cosine } from '@/lib/kairos/beliefs/cosine'
import { eliminationReason, type SelectionInput, type SelectionResult } from '@/lib/kairos/ideas/select'
import { IDEA_SURVIVORS_MAX } from '@/lib/kairos/ideas/types'

// Pure-novelty selection: every gate but ranked_out, then greedy max-min distance, Elo ignored.

export interface NoveltyPick {
  selection: SelectionResult[]
  // Greedy max-min score per viable key at the moment it was ranked (higher = further out).
  distance: Map<string, number>
}

const archiveDistance = (c: SelectionInput) => 1 - Math.max(0, Math.min(1, c.novelty.maxCosine))

export function selectNoveltySurvivors(
  inputs: readonly SelectionInput[],
  vectors: ReadonlyMap<string, readonly number[] | null>,
  max: number = IDEA_SURVIVORS_MAX,
): NoveltyPick {
  const out = new Map<string, SelectionResult>()
  const remaining: SelectionInput[] = []
  for (const c of inputs) {
    const reason = eliminationReason(c)
    if (reason) out.set(c.key, { key: c.key, status: reason === 'repeat' ? 'repeat' : 'eliminated', eliminatedReason: reason, rank: null })
    else remaining.push(c)
  }
  const picked: SelectionInput[] = []
  const distance = new Map<string, number>()
  const scoreOf = (c: SelectionInput): number => {
    const v = vectors.get(c.key)
    if (!v || v.length === 0) return -1
    let d = archiveDistance(c)
    for (const p of picked) {
      const pv = vectors.get(p.key)
      if (pv && pv.length) d = Math.min(d, 1 - cosine(v, pv))
    }
    return d
  }
  while (remaining.length > 0) {
    let best = 0
    let bestScore = scoreOf(remaining[0])
    for (let i = 1; i < remaining.length; i++) {
      const s = scoreOf(remaining[i])
      if (s > bestScore) {
        best = i
        bestScore = s
      }
    }
    const [c] = remaining.splice(best, 1)
    distance.set(c.key, Math.round(bestScore * 1000) / 1000)
    picked.push(c)
    const rank = picked.length
    const survives = rank <= max
    out.set(c.key, { key: c.key, status: survives ? 'survivor' : 'eliminated', eliminatedReason: survives ? null : 'ranked_out', rank })
  }
  return { selection: inputs.map((c) => out.get(c.key) as SelectionResult), distance }
}
