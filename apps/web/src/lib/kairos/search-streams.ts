import type { StreamClass } from './streamClass'

// Leaf module (no db, no data layer) so scripts and the entity scan can share
// the search scope without importing search-core's dependency graph.

// Operator signal + agent work: what an agent means by "a memory".
export const REAL_MEMORY_STREAMS = [
  'reflection', 'idea', 'agentic', 'concept', 'belief', 'constitution', 'execution',
] as const satisfies readonly StreamClass[]

// Machine / synthesis rows hidden by default (opt in with includeMachine).
export const MACHINE_STREAMS = [
  'trace', 'snapshot', 'delta', 'archetype', 'cortex', 'aether', 'advisory',
] as const satisfies readonly StreamClass[]
