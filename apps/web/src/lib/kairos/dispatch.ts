import { captureMemory } from '@/lib/data/memories'
import { retrieveContext } from './retrieve'
import { getRecipe } from './recipes/registry'
import type { MemoryWriteSpec, RecipeContext, Surface } from './recipes/_recipe'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3C — recipe dispatcher.
//
// Single entry point for running any registered recipe. Handles:
//   1. Lookup (throws RecipeNotFoundError on miss — never silent).
//   2. Retrieval (one canonical retrieveContext call, used by both surfaces).
//   3. Surface routing: flat() for BYOK / cron, expanded() for Claude Code.
//      Falls back to flat() when a recipe does not implement expanded.
//   4. Capture: primary write first. If captureMemory short-circuits on
//      externalId idempotency (returns created:false), no trace is written —
//      the existing primary already has its trace from the first run.
//   5. Extras + trace write. Trace is streamClass:'trace' tied to the
//      primary's memoryId via sourceMetadata.primaryMemoryId for downstream
//      meta-cognition (Oracle / Cartographer scan via get_trace_history).
//
// Doc 20 §2.1.
// ─────────────────────────────────────────────────────────────────────────

export class RecipeNotFoundError extends Error {
  constructor(name: string) {
    super(`Recipe not found: ${name}`)
    this.name = 'RecipeNotFoundError'
  }
}

export interface RunRecipeArgs {
  userId: string
  dominionId: string
  args?: Record<string, unknown>
  surface: Surface
}

export type RunRecipeResult =
  | { status: 'created'; memoryId: string; traceId: string }
  | { status: 'existing'; memoryId: string; traceId: null }

const RETRIEVAL_MEMORY_LIMIT = 25

export async function runRecipe(name: string, opts: RunRecipeArgs): Promise<RunRecipeResult> {
  const recipe = getRecipe(name)
  if (!recipe) throw new RecipeNotFoundError(name)

  const retrieval = await retrieveContext({
    userId: opts.userId,
    dominionId: opts.dominionId,
    memoryLimit: RETRIEVAL_MEMORY_LIMIT,
  })

  const ctx: RecipeContext = {
    userId: opts.userId,
    dominionId: opts.dominionId,
    args: opts.args ?? {},
    retrieval,
  }

  const fn = opts.surface === 'claude_code' && recipe.expanded ? recipe.expanded : recipe.flat
  const mode = fn === recipe.expanded ? 'expanded' : 'flat'

  const startedAt = Date.now()
  const output = await fn(ctx)
  const durationMs = Date.now() - startedAt

  // 1. Primary write — externalId idempotency happens inside captureMemory.
  const primaryResult = await captureMemory(opts.userId, toCaptureInput(output.primary))
  const primary = primaryResult.memory

  // Existing-row short-circuit: the original run already wrote its trace,
  // so a re-fire (cron retry, force=false dashboard click) must NOT spawn
  // an orphan trace pointing at the same primary.
  if (!primaryResult.created) {
    return { status: 'existing', memoryId: primary.id, traceId: null }
  }

  // 2. Optional extras. Each is wrapped — if one throws, the trace still
  // writes (and records the failure in extrasErrors) so we never leave a
  // primary persisted without an audit row. Re-fires return 'existing' on
  // the primary's externalId so the failed extra can't be retried; the
  // trace is the only signal that one was lost.
  const extrasErrors: Array<{ title: string; message: string }> = []
  if (output.extras?.length) {
    for (const spec of output.extras) {
      try {
        await captureMemory(opts.userId, toCaptureInput(spec))
      } catch (err) {
        extrasErrors.push({
          title: spec.title,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  // 3. Trace write — streamClass forced to 'trace'; never deduped.
  const traceBody = {
    recipe: name,
    mode,
    durationMs,
    primaryMemoryId: primary.id,
    ...(extrasErrors.length ? { extrasErrors } : {}),
    ...output.traceMeta,
  }
  const traceCapture = await captureMemory(opts.userId, {
    type: 'session_event',
    streamClass: 'trace',
    source: 'system',
    title: `${name} · ${primary.title}`,
    bodyMd: JSON.stringify(traceBody, null, 2),
    dominionId: opts.dominionId,
    sourceMetadata: traceBody,
  })

  return { status: 'created', memoryId: primary.id, traceId: traceCapture.memory.id }
}

function toCaptureInput(spec: MemoryWriteSpec) {
  return {
    type: spec.type,
    streamClass: spec.streamClass,
    source: spec.source,
    title: spec.title,
    bodyMd: spec.bodyMd,
    dominionId: spec.dominionId ?? null,
    sourceMetadata: spec.sourceMetadata ?? {},
  }
}
