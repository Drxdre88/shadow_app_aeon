// Mission model defaults, read from the shared model registry
// (packages/shared/src/ai/model-registry.json) so the runner, the web Hangar
// picker and the aeon_os scripts never drift. Read as plain JSON at runtime:
// the worker does not build or import the shared package.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type MissionEngine = 'claude' | 'copilot' | 'codex'

interface RegistryModel {
  id: string
  engineIds: Partial<Record<MissionEngine, string>>
  efforts: string[]
  defaultEffort: string | null
  status: string
}

interface Registry {
  reviewedAt: string
  models: RegistryModel[]
  defaults: { mission: Record<MissionEngine, { model: string; effort: string }> }
}

export const MODEL_REGISTRY_PATH = fileURLToPath(
  new URL('../../../packages/shared/src/ai/model-registry.json', import.meta.url),
)

function load(): Registry {
  try {
    return JSON.parse(readFileSync(MODEL_REGISTRY_PATH, 'utf8')) as Registry
  } catch (err) {
    throw new Error(`[worker/models] cannot read the model registry at ${MODEL_REGISTRY_PATH}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const registry = load()

export const MODEL_REGISTRY_REVIEWED_AT = registry.reviewedAt

/** The registry's mission default for an engine (model by that CLI's id + effort). */
export function missionDefault(engine: MissionEngine): { model: string; effort: string } {
  return registry.defaults.mission[engine]
}

/**
 * Effort for `model` on `engine` when no operator knob is set: the mission
 * effort when the model accepts it, else the model's own default. A model the
 * registry does not know (custom ids, `auto`) gets none — the CLI decides.
 */
export function missionEffort(engine: MissionEngine, model: string | null | undefined): string | null {
  if (!model) return null
  const entry = registry.models.find((m) => m.status === 'current' && m.engineIds[engine] === model)
  if (!entry || entry.efforts.length === 0) return null
  const preferred = missionDefault(engine).effort
  return entry.efforts.includes(preferred) ? preferred : entry.defaultEffort
}
