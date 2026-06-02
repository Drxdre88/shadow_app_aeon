import { db } from '@/lib/db'
import { enginePolicies } from '@/lib/db/schema'
import { and, eq, desc, isNull, or, sql } from 'drizzle-orm'
import { getProviderForUser } from './provider'
import type { AIProvider } from './provider'
import type { AiTier } from './providers'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 1 (B10) — Engine Router.
//
// Single entry point for every Kairos-driven inference. Callers describe
// the task; the router picks the engine. Resolution order:
//   1. User-scoped engine_policies row matching (taskType, sensitivity, urgency)
//   2. Global engine_policies row (user_id IS NULL) matching the same
//   3. Hard-coded DEFAULT_POLICIES fallback below
//
// Phase 1 ships with one effective lane: BYOK Anthropic at each tier.
// Adding OpenRouter / Gemini direct / STAF / Codex / Ollama is just
// extending DEFAULT_POLICIES + adding their provider implementations.
// ─────────────────────────────────────────────────────────────────────────

export type Sensitivity = 'public' | 'private' | 'sensitive'
export type Urgency = 'low' | 'normal' | 'high'

export interface RouteTaskRequest {
  taskType: string
  sensitivity?: Sensitivity
  urgency?: Urgency
  dominionId?: string | null
  contextSize?: number
}

export interface RouteDecision {
  providerId: string
  modelId: string | null
  tier: AiTier
  source: 'user_policy' | 'global_policy' | 'default'
}

interface PolicyDefault {
  taskType: string
  tier: AiTier
}

// Defaults read by every taskType not explicitly overridden. The tier-only
// shape is intentional: until non-BYOK providers land, every route resolves
// through the BYOK lane and the user's tier preferences.
const DEFAULT_POLICIES: PolicyDefault[] = [
  { taskType: 'brief',        tier: 'heavy' },
  { taskType: 'advisory',     tier: 'heavy' },
  { taskType: 'archetype',    tier: 'heavy' },
  { taskType: 'cortex',       tier: 'heavy' },
  { taskType: 'chat',         tier: 'standard' },
  { taskType: 'classify',     tier: 'cheap' },
  { taskType: 'summarise',    tier: 'cheap' },
  { taskType: 'reflect',      tier: 'standard' },
  { taskType: 'voice',        tier: 'cheap' },
  { taskType: 'shell_heavy',  tier: 'standard' },
  { taskType: 'code',         tier: 'standard' },
]

const FALLBACK_TIER: AiTier = 'standard'

function defaultTierFor(taskType: string): AiTier {
  return DEFAULT_POLICIES.find((p) => p.taskType === taskType)?.tier ?? FALLBACK_TIER
}

export async function routeTask(userId: string, req: RouteTaskRequest): Promise<RouteDecision> {
  const sensitivity = req.sensitivity ?? 'public'
  const urgency = req.urgency ?? 'normal'

  // One query, both user-scoped and global rows, ordered so user rows win.
  const rows = await db
    .select()
    .from(enginePolicies)
    .where(and(
      eq(enginePolicies.taskType, req.taskType),
      eq(enginePolicies.sensitivity, sensitivity),
      eq(enginePolicies.urgency, urgency),
      or(eq(enginePolicies.userId, userId), isNull(enginePolicies.userId)),
    ))
    .orderBy(
      // user rows (userId NOT NULL) first
      sql`${enginePolicies.userId} IS NULL`,
      desc(enginePolicies.priority),
    )
    .limit(1)

  const policy = rows[0]
  if (policy) {
    return {
      providerId: policy.providerId,
      modelId: policy.modelId,
      tier: (policy.tier as AiTier | null) ?? defaultTierFor(req.taskType),
      source: policy.userId === userId ? 'user_policy' : 'global_policy',
    }
  }

  return {
    providerId: 'byok',
    modelId: null,
    tier: defaultTierFor(req.taskType),
    source: 'default',
  }
}

// Convenience: resolve the route AND return a ready-to-call AIProvider.
// For Phase 1 every decision flows through the BYOK Vercel-SDK lane via
// getProviderForUser; later phases will dispatch to non-SDK engines (STAF,
// Codex, Ollama) inside this function based on `decision.providerId`.
export async function getProviderForTask(
  userId: string,
  req: RouteTaskRequest,
): Promise<{ decision: RouteDecision; provider: AIProvider }> {
  const decision = await routeTask(userId, req)
  const provider = await getProviderForUser(userId, decision.tier)
  return { decision, provider }
}
