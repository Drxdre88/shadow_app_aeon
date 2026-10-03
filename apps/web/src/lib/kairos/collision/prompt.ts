import { dataLine } from '@/lib/kairos/ideas/prompt-data'
import type { CollisionPair } from './types'

// Generator prompt text for collisions, used only in `on` mode with pairs.

export const COLLISION_SYSTEM_ADDENDUM = [
  'Collisions (optional): the data may list far-apart pairs (p1, p2, …) from different areas and times of the operator\'s life.',
  '- For a pair, look for a shared structure of RELATIONSHIPS (how things act on each other: causes, blocks, feeds, replaces, competes with), not a shared topic or shared words.',
  '- Write at most ONE candidate per pair. Give it "blend":"p1" and cite BOTH ids of that pair in its evidenceIds.',
  '- Never force a blend: if no real structure carries over, write no candidate for that pair and report {"pair":"p1","holds":false}.',
  '- Next to "candidates", add a top-level "blends" array, one entry per pair you considered:',
  '  {"pair":"p1","holds":true,"a":[{"rel":"verb","x":"entity","y":"entity"}],"b":[{"rel":"verb","x":"entity","y":"entity"}],"map":[{"a":"entity in A","b":"entity in B"}],"insight":"one sentence: what A teaches about B"}',
  '- "a" lists 2–6 two-entity relations from the first memory and "b" from the second, using words from each memory; "map" pairs every A entity with exactly one B entity.',
].join('\n')

export function collisionSystem(base: string): string {
  return `${base}\n${COLLISION_SYSTEM_ADDENDUM}`
}

const side = (area: string | null, date: string) => `${dataLine(area ?? 'cross-cutting', 60)} · ${date}`

export function collisionSection(pairs: readonly CollisionPair[]): string {
  const lines = ['## Far-apart pairs to collide (optional; see the system prompt)']
  for (const p of pairs) {
    lines.push(
      `- ${p.id} A: [${p.aId}] (${side(p.aArea, p.aDate)}) ${dataLine(p.aText, 400)}`,
      `     B: [${p.bId}] (${side(p.bArea, p.bDate)}) ${dataLine(p.bText, 400)}`,
    )
  }
  return lines.join('\n')
}

export function collisionIds(pairs: readonly CollisionPair[]): string[] {
  return pairs.flatMap((p) => [p.aId, p.bId])
}
