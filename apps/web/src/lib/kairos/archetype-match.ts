import type { ArchetypeOutput } from './archetypes-prompt'

// In-place archetype edits (Wave 1 "fewer rewrites"): instead of archiving a
// Dominion's archetypes and inserting a fresh set every night, match each
// generated archetype to a live one by normalised title (and summary) overlap.
// Matched + essentially unchanged → keep; matched + changed → update in place;
// unmatched → insert; live and not returned → archive. Pinned rows are never
// updated or archived, only matched (so a pinned theme is not duplicated).

export type IncomingArchetype = ArchetypeOutput['archetypes'][number]

export interface LiveArchetype {
  id: string
  title: string
  summary: string | null
  bodyMd: string
  pinned: boolean
}

export type ArchetypeEdit =
  | { kind: 'keep'; existing: LiveArchetype; incoming: IncomingArchetype }
  | { kind: 'update'; existing: LiveArchetype; incoming: IncomingArchetype }
  | { kind: 'insert'; incoming: IncomingArchetype }

export interface ArchetypeEditPlan {
  edits: ArchetypeEdit[]
  archiveIds: string[]
}

export const TITLE_MATCH = 0.5
export const LOOSE_TITLE_MATCH = 0.25
export const TEXT_MATCH = 0.4
export const BODY_UNCHANGED = 0.8
export const SUMMARY_UNCHANGED = 0.6

const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'as', 'at', 'by', 'with', 'from', 'vs'])

export function normaliseText(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function tokens(text: string | null | undefined): Set<string> {
  return new Set(normaliseText(text).split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t)))
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / (a.size + b.size - shared)
}

export function titleSimilarity(a: string, b: string): number {
  return normaliseText(a) === normaliseText(b) ? 1 : jaccard(tokens(a), tokens(b))
}

// null = not the same archetype; otherwise a score for greedy pairing.
export function matchScore(existing: LiveArchetype, incoming: IncomingArchetype): number | null {
  const title = titleSimilarity(existing.title, incoming.title)
  const text = jaccard(tokens(`${existing.title} ${existing.summary ?? ''}`), tokens(`${incoming.title} ${incoming.summary}`))
  if (title >= TITLE_MATCH || (title >= LOOSE_TITLE_MATCH && text >= TEXT_MATCH)) return title + text
  return null
}

export function isUnchanged(existing: LiveArchetype, incoming: IncomingArchetype): boolean {
  return normaliseText(existing.title) === normaliseText(incoming.title)
    && jaccard(tokens(existing.summary), tokens(incoming.summary)) >= SUMMARY_UNCHANGED
    && jaccard(tokens(existing.bodyMd), tokens(incoming.body)) >= BODY_UNCHANGED
}

export function planArchetypeEdits(live: readonly LiveArchetype[], incoming: readonly IncomingArchetype[]): ArchetypeEditPlan {
  const pairs: Array<{ e: number; i: number; score: number }> = []
  live.forEach((existing, e) => incoming.forEach((inc, i) => {
    const score = matchScore(existing, inc)
    if (score !== null) pairs.push({ e, i, score })
  }))
  pairs.sort((x, y) => y.score - x.score || x.i - y.i || x.e - y.e)

  const byIncoming = new Map<number, LiveArchetype>()
  const taken = new Set<number>()
  for (const p of pairs) {
    if (taken.has(p.e) || byIncoming.has(p.i)) continue
    taken.add(p.e)
    byIncoming.set(p.i, live[p.e])
  }

  const edits: ArchetypeEdit[] = incoming.map((inc, i) => {
    const existing = byIncoming.get(i)
    if (!existing) return { kind: 'insert', incoming: inc }
    if (existing.pinned || isUnchanged(existing, inc)) return { kind: 'keep', existing, incoming: inc }
    return { kind: 'update', existing, incoming: inc }
  })
  const archiveIds = live.filter((l, e) => !taken.has(e) && !l.pinned).map((l) => l.id)
  return { edits, archiveIds }
}
