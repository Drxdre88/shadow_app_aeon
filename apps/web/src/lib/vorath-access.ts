// Vorath (Kairos) is the owner's private brain, hidden from beta testers.
// One predicate decides who may see or call any of it: a user-id allowlist
// (VORATH_USER_IDS, comma list), falling back to KAIROS_OPERATOR_USER_ID.
// Role is NOT used: API-key / OAuth callers always resolve to role 'user'.
// With neither env set, only non-production (dev, tests) is open.

export function vorathUserIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.VORATH_USER_IDS?.trim() || env.KAIROS_OPERATOR_USER_ID?.trim() || ''
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
}

export function canUseVorath(userId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const ids = vorathUserIds(env)
  if (ids.size === 0) return env.NODE_ENV !== 'production'
  return !!userId && ids.has(userId)
}

export class VorathAccessError extends Error {
  constructor() {
    super('Not found')
    this.name = 'VorathAccessError'
  }
}

export function assertVorath(userId: string | null | undefined): void {
  if (!canUseVorath(userId)) throw new VorathAccessError()
}

type WithMetadata = { metadata?: Record<string, unknown> | null }

// Card metadata.hangar is a Vorath mission (instruction, autoRun). Generic task
// writes from non-owners drop it so a co-member can't arm or rewrite a mission
// the owner later launches.
export function withoutVorathTaskFields<T extends WithMetadata>(userId: string | null | undefined, data: T): T {
  if (canUseVorath(userId) || !data.metadata || !('hangar' in data.metadata)) return data
  const { hangar: _hangar, ...metadata } = data.metadata
  return { ...data, metadata }
}

type ProjectPatch = { dominionId?: string | null; settings?: Record<string, unknown> }

// Board settings.hangar (auto-launch, trigger column) and the Dominion link are
// Vorath; generic project updates from non-owners drop them.
export function withoutVorathProjectFields<T extends ProjectPatch>(userId: string | null | undefined, data: T): T {
  if (canUseVorath(userId)) return data
  const { dominionId: _dominionId, ...rest } = data
  if (!rest.settings || !('hangar' in rest.settings)) return rest as T
  const { hangar: _hangar, ...settings } = rest.settings
  return { ...rest, settings } as T
}
