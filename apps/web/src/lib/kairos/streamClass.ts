export const STREAM_CLASSES = [
  'idea',
  'agentic',
  'execution',
  'reflection',
  'cortex',
  'archetype',
  'advisory',
  'trace',
  // Ephemeral machine status (nightly board snapshots). Deliberately NOT in the
  // briefer's SUBSTRATE_STREAMS — snapshots must not pollute the 'idea' pool.
  // Short-lived: the snapshot lifecycle pass archives them past their TTL.
  'snapshot',
  // Aether — daily cross-Dominion synthesis. One per UTC day; not in briefer substrate.
  'aether',
  // Micro-consolidation — intraday "what changed since the last cortex
  // reading" fold, one per Dominion per off-peak run (see micro-consolidate.ts).
  // Below reflection/idea in trust; feeds the nightly cortex/aether generators'
  // "Today so far" grounding section, not the briefer substrate.
  'delta',
] as const

export type StreamClass = (typeof STREAM_CLASSES)[number]

export function isStreamClass(value: unknown): value is StreamClass {
  return typeof value === 'string' && (STREAM_CLASSES as readonly string[]).includes(value)
}
