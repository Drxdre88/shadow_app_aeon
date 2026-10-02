import { and, desc, eq, gte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { thinkingJobs } from '@/lib/db/schema'
import { FALLBACK_ERROR_PREFIX } from '@/lib/data/thinking-jobs'
import type { ThinkingJobKind } from '@/lib/kairos/engine/types'
import { BRAIN_JOBS } from '@/lib/kairos/routines/catalog'
import type {
  AnsweredBy,
  BrainKindStatus,
  BrainRoutineStatus,
  KairosBrainStatus,
} from '@/lib/kairos/routines/status-types'

// Brain status — how Kairos's thinking jobs were answered over the last week
// (routine on the Max plan, backup on the paid key / cron, or missed). The
// query is pure DB access; summariseBrainStatus is a pure function over its rows.

const DAY_MS = 24 * 60 * 60 * 1000
export const BRAIN_STATUS_WINDOW_MS = 7 * DAY_MS
export const BRAIN_STATUS_ROW_LIMIT = 2000
// A scheduled routine that has not claimed for this long is 'silent'.
export const ROUTINE_SILENT_AFTER_MS = 26 * 60 * 60 * 1000

export interface BrainJobRow {
  kind: string
  status: string
  claimedBy: string | null
  claimedAt: Date | null
  completedAt: Date | null
  deadlineAt: Date
  error: string | null
}

export async function listBrainJobsSince(userId: string, since: Date): Promise<BrainJobRow[]> {
  return db
    .select({
      kind: thinkingJobs.kind,
      status: thinkingJobs.status,
      claimedBy: thinkingJobs.claimedBy,
      claimedAt: thinkingJobs.claimedAt,
      completedAt: thinkingJobs.completedAt,
      deadlineAt: thinkingJobs.deadlineAt,
      error: thinkingJobs.error,
    })
    .from(thinkingJobs)
    .where(and(eq(thinkingJobs.userId, userId), gte(thinkingJobs.deadlineAt, since)))
    .orderBy(desc(thinkingJobs.deadlineAt))
    .limit(BRAIN_STATUS_ROW_LIMIT)
}

// A failed/expired job whose error says something else covered it: the
// sweep's fallback ('fallback: …'), a cron, or the chat watchdog answering on
// the paid key.
const BACKUP_NOTE = /\bcron\b|\bpaid key\b|^chat-watchdog:/i
// A chat turn taken over by a newer message: nothing was owed, so it is
// neither answered nor missed.
const SUPERSEDED_PREFIX = 'superseded:'

// null = not an outcome yet (open, before its deadline) or not owed.
export function classifyBrainJob(row: BrainJobRow, now: Date): AnsweredBy | null {
  switch (row.status) {
    case 'done':
      return row.claimedBy === 'routine' ? 'routine' : 'backup'
    case 'fallback':
      return 'backup'
    case 'failed':
    case 'expired': {
      const error = row.error?.trim() ?? ''
      if (error.startsWith(SUPERSEDED_PREFIX)) return null
      if (error.startsWith(FALLBACK_ERROR_PREFIX) || BACKUP_NOTE.test(error)) return 'backup'
      return 'missed'
    }
    case 'queued':
    case 'claimed':
      return row.deadlineAt.getTime() <= now.getTime() ? 'missed' : null
    default:
      return null
  }
}

function eventTime(row: BrainJobRow): Date {
  return row.completedAt ?? row.claimedAt ?? row.deadlineAt
}

function emptyCounts(): Record<AnsweredBy, number> {
  return { routine: 0, backup: 0, missed: 0 }
}

function startOfYesterdayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
}

export interface SummariseOptions {
  // KAIROS_TELEGRAM_ROUTINE: when off, the chat routine is 'off' regardless of history.
  chatRoutineFlagOn?: boolean
}

export type BrainStatusSummary = Pick<KairosBrainStatus, 'lastNight' | 'backupKinds' | 'kinds' | 'routines'>

export function summariseBrainStatus(
  rows: readonly BrainJobRow[],
  now: Date,
  options: SummariseOptions = {},
): BrainStatusSummary {
  const weekStart = now.getTime() - BRAIN_STATUS_WINDOW_MS
  const nightStart = startOfYesterdayUtc(now).getTime()
  const dayStart = now.getTime() - DAY_MS
  const known = new Set<string>(BRAIN_JOBS.map((j) => j.kind))

  const lastNight = emptyCounts()
  const backupSeen = new Set<string>()
  const perKind = new Map<string, { last: { at: Date; by: AnsweredBy } | null; week: Record<AnsweredBy, number> }>(
    BRAIN_JOBS.map((j) => [j.kind, { last: null, week: emptyCounts() }]),
  )
  let brainLastClaim: Date | null = null
  let chatLatest: { at: Date; by: AnsweredBy } | null = null
  let chatLastClaim: Date | null = null

  for (const row of rows) {
    const by = classifyBrainJob(row, now)
    if (!by) continue
    const at = eventTime(row)
    const deadline = row.deadlineAt.getTime()

    if (deadline >= nightStart) lastNight[by] += 1
    if (by === 'backup' && known.has(row.kind) && at.getTime() >= dayStart) backupSeen.add(row.kind)

    const entry = perKind.get(row.kind)
    if (entry && deadline >= weekStart) {
      entry.week[by] += 1
      if (!entry.last || at > entry.last.at) entry.last = { at, by }
    }

    const claim = by === 'routine' ? row.claimedAt ?? row.completedAt : null
    if (row.kind === 'chat') {
      if (!chatLatest || at > chatLatest.at) chatLatest = { at, by }
      if (claim && (!chatLastClaim || claim > chatLastClaim)) chatLastClaim = claim
    } else if (claim && (!brainLastClaim || claim > brainLastClaim)) {
      brainLastClaim = claim
    }
  }

  const kinds: BrainKindStatus[] = BRAIN_JOBS.map((j) => {
    const entry = perKind.get(j.kind)!
    return {
      kind: j.kind,
      lastAt: entry.last ? entry.last.at.toISOString() : null,
      lastAnsweredBy: entry.last ? entry.last.by : null,
      week: entry.week,
    }
  })

  const backupKinds: ThinkingJobKind[] = BRAIN_JOBS.map((j) => j.kind).filter((k) => backupSeen.has(k))

  const brainState: BrainRoutineStatus['state'] =
    brainLastClaim && now.getTime() - brainLastClaim.getTime() <= ROUTINE_SILENT_AFTER_MS ? 'live' : 'silent'
  // Chat is on demand: it is live when the latest Telegram turn was answered
  // by the routine, silent when the backup or nobody answered it.
  const chatState: BrainRoutineStatus['state'] = !options.chatRoutineFlagOn
    ? 'off'
    : chatLatest?.by === 'routine' ? 'live' : 'silent'

  const routines: BrainRoutineStatus[] = [
    { id: 'brain', lastClaimAt: brainLastClaim ? (brainLastClaim as Date).toISOString() : null, state: brainState },
    { id: 'chat', lastClaimAt: chatLastClaim ? (chatLastClaim as Date).toISOString() : null, state: chatState },
  ]

  return { lastNight, backupKinds, kinds, routines }
}
