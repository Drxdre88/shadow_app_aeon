import {
  countArchetypeChangesSince,
  countFreshInputs,
  countRowsCreatedSince,
  dominionUpdatedAt,
  latestArchetypeRunAt,
  latestLiveCreatedAt,
} from '@/lib/data/synthesis-change'

// Change checks for the nightly synthesis (Wave 1 "fewer rewrites"): a
// Dominion's archetypes or cortex, or the whole aether, are only re-synthesised
// when new input arrived since the last live output — or as a weekly refresh,
// so nothing goes stale forever. A skip plans no thinking job (nothing owed,
// so brain status never counts it missed); the fallback crons trace it as an
// expected 'skipped' run.

export const REFRESH_AFTER_DAYS = 7
const DAY_MS = 86_400_000

export const NO_NEW_INPUT = 'no new input since last run'

export type ChangeReason = 'first_run' | 'weekly_refresh' | 'new_input' | 'strategy_changed' | 'no_new_input'

export interface ChangeDecision {
  run: boolean
  reason: ChangeReason
}

export interface ChangeInputs {
  lastOutputAt: Date | null
  newInputs: number
  strategyChangedAt?: Date | null
  now: Date
}

export function decideRefresh(i: ChangeInputs): ChangeDecision {
  if (!i.lastOutputAt) return { run: true, reason: 'first_run' }
  if (i.now.getTime() - i.lastOutputAt.getTime() >= REFRESH_AFTER_DAYS * DAY_MS) return { run: true, reason: 'weekly_refresh' }
  if (i.newInputs > 0) return { run: true, reason: 'new_input' }
  if (i.strategyChangedAt && i.strategyChangedAt.getTime() > i.lastOutputAt.getTime()) return { run: true, reason: 'strategy_changed' }
  return { run: false, reason: 'no_new_input' }
}

const needsReads = (last: Date | null, now: Date): last is Date => last !== null && now.getTime() - last.getTime() < REFRESH_AFTER_DAYS * DAY_MS

export async function archetypeChangeCheck(userId: string, dominionId: string, now: Date = new Date()): Promise<ChangeDecision> {
  const lastOutputAt = await latestArchetypeRunAt(userId, dominionId)
  if (!needsReads(lastOutputAt, now)) return decideRefresh({ lastOutputAt, newInputs: 0, now })
  const newInputs = await countFreshInputs(userId, dominionId, lastOutputAt)
  const strategyChangedAt = newInputs > 0 ? null : await dominionUpdatedAt(userId, dominionId)
  return decideRefresh({ lastOutputAt, newInputs, strategyChangedAt, now })
}

export async function cortexChangeCheck(userId: string, dominionId: string, now: Date = new Date()): Promise<ChangeDecision> {
  const lastOutputAt = await latestLiveCreatedAt(userId, 'cortex', dominionId)
  if (!needsReads(lastOutputAt, now)) return decideRefresh({ lastOutputAt, newInputs: 0, now })
  let newInputs = await countFreshInputs(userId, dominionId, lastOutputAt)
  if (newInputs === 0) newInputs = await countArchetypeChangesSince(userId, dominionId, lastOutputAt)
  const strategyChangedAt = newInputs > 0 ? null : await dominionUpdatedAt(userId, dominionId)
  return decideRefresh({ lastOutputAt, newInputs, strategyChangedAt, now })
}

export async function aetherChangeCheck(userId: string, now: Date = new Date()): Promise<ChangeDecision> {
  const lastOutputAt = await latestLiveCreatedAt(userId, 'aether', null)
  if (!needsReads(lastOutputAt, now)) return decideRefresh({ lastOutputAt, newInputs: 0, now })
  const newInputs = await countRowsCreatedSince(userId, 'cortex', lastOutputAt)
  return decideRefresh({ lastOutputAt, newInputs, now })
}
