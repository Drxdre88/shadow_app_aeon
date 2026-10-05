import type { KairosIdeaAtlasState } from '@/lib/data/validators/kairos-idea-atlas'
import { allCells, cellKey } from './cells'

// Tonight's atlas targets ('on' mode): empty cells of the active grid, the
// never-targeted first, then the longest-untargeted, then the least tried;
// ties broken by a stable per-night hash so the pick rotates across nights.
// Dormant Dominions (Living Dominions 'on') are never targeted; 'cross' stays.

export const ATLAS_TARGETS_PER_NIGHT = 4

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function pickAtlasTargets(
  state: KairosIdeaAtlasState,
  dominions: ReadonlyArray<{ id: string; dormant?: boolean }>,
  date: string,
  k: number = ATLAS_TARGETS_PER_NIGHT,
): string[] {
  const empty = allCells(dominions.filter((d) => !d.dormant).map((d) => d.id))
    .map((c) => cellKey(c.area, c.kind, c.leap))
    .filter((key) => !state.cells[key]?.holder)
    .map((key) => ({ key, cell: state.cells[key], h: hash(`${date}|${key}`) }))
  empty.sort((a, b) => {
    const ta = a.cell?.targetedOn ?? null
    const tb = b.cell?.targetedOn ?? null
    if ((ta === null) !== (tb === null)) return ta === null ? -1 : 1
    if (ta !== null && tb !== null && ta !== tb) return ta < tb ? -1 : 1
    const ra = a.cell?.tries ?? 0
    const rb = b.cell?.tries ?? 0
    if (ra !== rb) return ra - rb
    return a.h - b.h || (a.key < b.key ? -1 : 1)
  })
  return empty.slice(0, Math.max(0, k)).map((e) => e.key)
}
