// Single source of truth for which AI models Aeon offers and defaults to.
// The data lives in model-registry.json (plain JSON so the kairos-worker,
// aeon_os scripts and the freshness checker can read it without a TS build);
// this file is the typed view the web app imports.
//
// To change models: edit the JSON, bump `reviewedAt`, run the tests.

import registry from './model-registry.json'

export type ModelProvider = 'anthropic' | 'openai' | 'google'
export type ModelRole = 'flagship' | 'balanced' | 'fast' | 'coding' | 'top'
export type ModelStatus = 'current' | 'legacy'
export type ModelEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type HangarEngine = 'copilot' | 'claude' | 'codex'
export type TierRole = 'cheap' | 'standard' | 'heavy'

export interface ModelEntry {
  provider: ModelProvider
  /** Vendor API id (what the AI SDK sends). */
  id: string
  /** Per-CLI ids where they differ from the API id (Copilot uses dots). */
  engineIds: Partial<Record<HangarEngine, string>>
  label: string
  role: ModelRole
  /** Context window in thousands of tokens; null when not verified. */
  contextK: number | null
  /** Effort levels the model accepts; empty = no effort parameter. */
  efforts: ModelEffort[]
  defaultEffort: ModelEffort | null
  status: ModelStatus
  /** ISO date; null when the release date was not verified. */
  released: string | null
  note: string
}

export interface TierDefault {
  provider: ModelProvider
  model: string
  effort: ModelEffort
}

export interface EngineDefault {
  model: string
  effort: ModelEffort
}

export interface RoleDefaults {
  heavy: TierDefault
  standard: TierDefault
  cheap: TierDefault
  routine: TierDefault
  mission: Record<HangarEngine, EngineDefault>
  reviewer: EngineDefault & { engine: HangarEngine }
}

interface RegistryFile {
  reviewedAt: string
  models: ModelEntry[]
  defaults: RoleDefaults
  legacyRemap: Record<string, string>
}

const data = registry as RegistryFile

export const MODEL_REGISTRY: readonly ModelEntry[] = data.models
export const MODEL_REGISTRY_REVIEWED_AT: string = data.reviewedAt
export const DEFAULT_ROLE_MODEL: RoleDefaults = data.defaults
export const LEGACY_REMAP: Readonly<Record<string, string>> = data.legacyRemap

export const CURRENT_MODELS: readonly ModelEntry[] = MODEL_REGISTRY.filter((m) => m.status === 'current')

export function findModel(id: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id)
}

/** Old API id → current id; unknown or current ids pass through unchanged. */
export function remapLegacyModel(id: string): string {
  return Object.hasOwn(LEGACY_REMAP, id) ? LEGACY_REMAP[id] : id
}

/**
 * The effort to send for `modelId` on a tier: the tier's default when the
 * model accepts it, else the model's own default, else none (e.g. Haiku).
 */
export function effortFor(modelId: string, preferred?: ModelEffort | null): ModelEffort | null {
  const entry = findModel(remapLegacyModel(modelId))
  if (!entry || entry.efforts.length === 0) return null
  if (preferred && entry.efforts.includes(preferred)) return preferred
  return entry.defaultEffort
}

/** Current models a Hangar engine can run, by that engine's CLI id. */
export function engineModels(engine: HangarEngine): { id: string; label: string; entry: ModelEntry }[] {
  return CURRENT_MODELS.flatMap((entry) => {
    const id = entry.engineIds[engine]
    return id ? [{ id, label: entry.label, entry }] : []
  })
}
