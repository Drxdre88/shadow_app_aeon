import { spliceBeforeDataEnd } from '@/lib/kairos/ideas/generate-prompt'
import type { IdeaMeta } from '@/lib/kairos/ideas/types'
import { collisionMode } from '@/lib/kairos/collision/flag'
import { applyCollisionGate, type CollisionGateStats } from '@/lib/kairos/collision/gate'
import { blendOf } from '@/lib/kairos/collision/mapping'
import { collisionIds, collisionSection, collisionSystem } from '@/lib/kairos/collision/prompt'
import { readCollisionContext, type BridgeMeta, type CollisionContext } from '@/lib/kairos/collision/types'
import type { IdeaExtension, JobContext } from './types'

// Lane B (collision engine) idea-tournament hooks, KAIROS_COLLISIONS.
// off: every hook returns its input; nothing is read. observe: pairs are
// picked into context.collision only. on: pairs are offered, blends gated,
// bridges carried to the idea and linked on an owner/operator accept.
// DB modules load lazily so importing the seam never opens a connection.

interface CollisionScratch {
  bridges: Map<string, BridgeMeta>
  stats: CollisionGateStats
}

// The plan-time context, only when the flag and the job both say `on` with pairs.
function liveContext(jobContext: JobContext): CollisionContext | null {
  if (collisionMode() !== 'on') return null
  const ctx = readCollisionContext(jobContext)
  return ctx && ctx.mode === 'on' && ctx.pairs.length > 0 ? ctx : null
}

export const collisionExtension: IdeaExtension = {
  async planGenerate(draft, ctx) {
    const mode = collisionMode()
    if (mode === 'off') return draft
    const { gatherCollisions } = await import('@/lib/kairos/collision/plan')
    const collision = await gatherCollisions(ctx.userId, ctx.now, ctx.day, ctx.dominions, ctx.errors, mode)
    if (!collision) return draft
    const context = { ...draft.context, collision }
    if (mode !== 'on' || collision.pairs.length === 0) return { ...draft, context }
    return {
      system: collisionSystem(draft.system),
      prompt: spliceBeforeDataEnd(draft.prompt, collisionSection(collision.pairs)),
      validMemoryIds: [...new Set([...draft.validMemoryIds, ...collisionIds(collision.pairs)])],
      context,
    }
  },

  parseOptions(jobContext) {
    if (!liveContext(jobContext)) return {}
    return {
      extendCandidate: (rawItem, built) => {
        const blend = blendOf(rawItem)
        return blend ? { ...built, blend } : built
      },
      keepRaw: true,
    }
  },

  afterParse(grounded, scope) {
    const ctx = liveContext(scope.jobContext)
    if (!ctx) return grounded
    const gated = applyCollisionGate(grounded, ctx, grounded.raw)
    scope.scratch.collision = { bridges: gated.bridges, stats: gated.stats } satisfies CollisionScratch
    return gated.grounded
  },

  enrichStoredCandidate(stored, candidate, ctx) {
    const scratch = ctx.scratch.collision as CollisionScratch | undefined
    const bridge = scratch?.bridges.get(candidate.key)
    return bridge ? { ...stored, bridge } : stored
  },

  summarizeGenerate(_judge, ctx) {
    const scratch = ctx.scratch.collision as CollisionScratch | undefined
    return scratch ? { collision: scratch.stats } : null
  },

  metaExtras(candidate, _selection, critique) {
    if (collisionMode() !== 'on' || !candidate.bridge) return null
    const mappingHolds = typeof critique?.mappingHolds === 'boolean' ? critique.mappingHolds : null
    return { bridge: { ...candidate.bridge, mappingHolds } }
  },

  composeExtraLines(meta: IdeaMeta) {
    const b = meta.bridge
    if (!b) return []
    const side = (area: string | null) => area?.trim() || 'cross-cutting'
    const insight = b.insight?.trim()
    return [`**Collision.** ${side(b.aArea)} ↔ ${side(b.bArea)}${insight ? ` — ${insight}` : ''}`]
  },

  async onIdeaOutcome(event) {
    if (event.outcome !== 'accepted' || collisionMode() !== 'on') return
    const { bridgeOf, bridgingOrigin, writeIdeaBridge } = await import('@/lib/kairos/collision/bridge')
    if (!bridgingOrigin(event.origin) || !bridgeOf(event.meta)) return
    try {
      await writeIdeaBridge(event.userId, event.memoryId, event.meta, event.origin)
    } catch (err) {
      console.warn('[kairos:collision] bridge write failed:', err instanceof Error ? err.message : String(err))
    }
  },
}
