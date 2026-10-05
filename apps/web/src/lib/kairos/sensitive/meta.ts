import type { SensitiveTopic } from './lexicon'

// sourceMetadata keys (client-safe; no DB imports). `sensitive` is the lasting
// label; `sensitiveHeld` is true until the owner confirms the row.
export const SENSITIVE_KEY = 'sensitive'
export const SENSITIVE_HELD_KEY = 'sensitiveHeld'
export const SENSITIVE_TOPICS_KEY = 'sensitiveTopics'

export interface SensitiveStamp {
  sensitive: true
  sensitiveHeld: true
  sensitiveTopics: SensitiveTopic[]
}

export function isHeldSensitive(sourceMetadata: unknown): boolean {
  return !!sourceMetadata && typeof sourceMetadata === 'object'
    && (sourceMetadata as Record<string, unknown>)[SENSITIVE_HELD_KEY] === true
}

export function sensitiveTopicsOf(sourceMetadata: unknown): SensitiveTopic[] {
  const raw = sourceMetadata && typeof sourceMetadata === 'object'
    ? (sourceMetadata as Record<string, unknown>)[SENSITIVE_TOPICS_KEY]
    : null
  return Array.isArray(raw) ? raw.filter((t): t is SensitiveTopic => typeof t === 'string') : []
}
