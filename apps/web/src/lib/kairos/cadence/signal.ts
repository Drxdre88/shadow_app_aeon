import { ne } from 'drizzle-orm'
import { memories } from '@/lib/db/schema'
import { listRecentMemories } from '@/lib/data/memories'
import { listJobs } from '@/lib/data/thinking-jobs'
import type { ThinkingJobKind, ThinkingJobRow } from '@/lib/kairos/engine/types'
import { countTodayEntriesSince } from '@/lib/kairos/today'
import { londonDayStart } from '@/lib/kairos/thinking/deadlines'

// Daytime cadence gates (spec A): cheap reads only — no model call, no
// embedding. Both daytime kinds plan nothing unless KAIROS_DAYTIME_THINKING=1.

export { daytimeThinkingEnabled } from './flag'

export const DEFAULT_REFLECT_MAX_PER_DAY = 6

export function reflectMaxPerDay(): number {
  const raw = process.env.KAIROS_REFLECT_MAX_PER_DAY
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_REFLECT_MAX_PER_DAY
}

// The owner (and the owner's own agents through MCP) count as activity;
// Kairos's own lines in "today" never wake him.
const ACTIVE_SPEAKERS: Array<'owner' | 'agent'> = ['owner', 'agent']

const DAY_SCAN_LIMIT = 100

// Today's (London) jobs of one daytime kind, newest first.
export async function listDaytimeJobsToday(userId: string, kind: ThinkingJobKind, now: Date): Promise<ThinkingJobRow[]> {
  return listJobs(userId, { kind, since: londonDayStart(now), limit: DAY_SCAN_LIMIT })
}

// When Kairos last looked: the newest slot of this kind today (any status — a
// missed slot still moves the mark on), else the start of the London day.
export function lastLookedAt(today: readonly ThinkingJobRow[], now: Date): Date {
  const latest = today.reduce<Date | null>((acc, j) => (!acc || j.createdAt > acc ? j.createdAt : acc), null)
  return latest ?? londonDayStart(now)
}

// Something new from the owner since `since`: a "today" line from the owner or
// their agents, or any memory not written by Kairos (voice note, captured
// session, inbox item, chat summary) created since.
export async function hasOwnerActivitySince(userId: string, since: Date, now: Date): Promise<boolean> {
  const todayCount = await countTodayEntriesSince(userId, since, { speakers: ACTIVE_SPEAKERS })
  if (todayCount > 0) return true
  const recent = await listRecentMemories(userId, [ne(memories.streamClass, 'agentic')], { start: since, end: now }, 1)
  return recent.length > 0
}
