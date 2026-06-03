import type { MemoryType, MemorySource } from '@/lib/data/validators'
import type { inspectDominion } from '@/lib/data/dominions'
import type { StreamClass } from '../streamClass'

export type Surface = 'byok' | 'claude_code'

// Bundle shape mirrors the existing inspectDominion() return — the canonical
// Dominion top-of-mind snapshot. Phase 3's retrieve.ts will return this from
// retrieveContext() so recipes don't reach into the data layer directly.
export type RetrievalBundle = Awaited<ReturnType<typeof inspectDominion>>

export interface RetrievedMemory {
  id: string
  title: string
  body: string
  streamClass: StreamClass
  createdAt: Date
}

export interface RetrievalResult {
  bundle: RetrievalBundle | null
  cortex: RetrievedMemory | null
  archetypes: RetrievedMemory[]
  substrate: RetrievedMemory[]
  // Recent trace memories scoped to the Dominion — Oracle/Cartographer use
  // these for meta-cognition over prior recipe runs.
  traces: RetrievedMemory[]
}

// surface lives on the dispatcher, not the context — recipes implement two
// methods (flat/expanded) and the dispatcher picks which to call. Keeping
// `surface` off RecipeContext prevents recipes from branching on it inside
// flat() or expanded().
export interface RecipeContext {
  userId: string
  dominionId: string
  args: Record<string, unknown>
  retrieval: RetrievalResult
}

export interface MemoryWriteSpec {
  type: MemoryType
  streamClass: StreamClass
  source: MemorySource
  title: string
  bodyMd: string
  dominionId?: string | null
  sourceMetadata?: Record<string, unknown>
}

// Supersedes doc 16 §3.3 shape — forces every recipe to declare ONE primary
// write (the memory the trace points at). Extras are optional secondary
// writes. Without a primary, traces would point at nothing meaningful.
export interface RecipeOutput {
  primary: MemoryWriteSpec
  extras?: MemoryWriteSpec[]
  traceMeta: Record<string, unknown>
}

export interface RecipeDescriptor {
  name: string
  description: string
  reads: readonly StreamClass[]
  writes: readonly StreamClass[]
}

export interface Recipe extends RecipeDescriptor {
  flat(ctx: RecipeContext): Promise<RecipeOutput>
  expanded?(ctx: RecipeContext): Promise<RecipeOutput>
}
