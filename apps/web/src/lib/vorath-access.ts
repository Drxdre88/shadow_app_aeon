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
