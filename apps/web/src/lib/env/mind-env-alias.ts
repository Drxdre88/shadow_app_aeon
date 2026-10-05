const NEW_PREFIX = 'VORATH_'
const OLD_PREFIX = 'KAIROS_'

export type MindEnv = Record<string, string | undefined>

/** Copies every non-empty VORATH_* value onto its KAIROS_* twin (VORATH wins) and returns the KAIROS_* keys it set. */
export function applyMindEnvAliases(env: MindEnv): string[] {
  const applied: string[] = []
  for (const key of Object.keys(env)) {
    if (!key.startsWith(NEW_PREFIX) || key.length === NEW_PREFIX.length) continue
    const value = env[key]
    if (value === undefined || value === '') continue
    const target = OLD_PREFIX + key.slice(NEW_PREFIX.length)
    env[target] = value
    applied.push(target)
  }
  return applied.sort()
}
