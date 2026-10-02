import { DEFAULT_ROLE_MODEL, MODEL_REGISTRY_REVIEWED_AT, engineModels, type HangarEngine } from '@aeon/shared/ai/models'

// Derived from the shared model registry: each engine lists the current models
// it can run, by that CLI's own id (Copilot uses dotted ids).
export const HANGAR_MODELS_CHECKED_AT = MODEL_REGISTRY_REVIEWED_AT

interface HangarModelOption {
  id: string
  label: string
}

const ENGINES: readonly HangarEngine[] = ['copilot', 'claude', 'codex']

const models: Record<string, readonly HangarModelOption[]> = Object.fromEntries(
  ENGINES.map((engine) => [engine, engineModels(engine).map(({ id, label }) => ({ id, label }))]),
)

export function getHangarModels(engine: string): readonly HangarModelOption[] {
  return Object.hasOwn(models, engine) ? models[engine] : []
}

/** What the runner uses when a card names no model (the worker reads the same registry). */
export function getHangarDefault(engine: string): { model: string; effort: string } | null {
  return Object.hasOwn(DEFAULT_ROLE_MODEL.mission, engine)
    ? DEFAULT_ROLE_MODEL.mission[engine as HangarEngine]
    : null
}
