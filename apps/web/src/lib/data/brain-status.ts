import { and, count, desc, eq, gte, isNull, max, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, oauthAccessTokens, projects, thinkingJobs } from '@/lib/db/schema'
import { FALLBACK_ERROR_PREFIX } from '@/lib/data/thinking-jobs'
import { notArchivedSql } from '@/lib/data/board-visibility'
import { PAID_BACKUP_OFF_NOTE } from '@/lib/ai/paid-backup-off'
import type { ThinkingJobKind } from '@/lib/kairos/engine/types'
import { daytimeThinkingEnabled } from '@/lib/kairos/cadence/flag'
import { BRAIN_JOBS, ROUTINES, type RoutineId } from '@/lib/kairos/routines/catalog'
import { telegramConfigured } from '@/lib/kairos/telegram'
import type {
  AnsweredBy,
  BrainKindStatus,
  BrainRoutineStatus,
  KairosBrainStatus,
  KairosChatLatency,
  KairosSetupSignals,
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
  // Optional so fixtures that predate chat latency still type-check.
  createdAt?: Date | null
  // output->'timing' (chat jobs, stamped at settle by recordChatTiming).
  timing?: unknown
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
      createdAt: thinkingJobs.createdAt,
      timing: sql<unknown>`${thinkingJobs.output}->'timing'`,
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
// Declined because the user switched the paid backup off: nothing covered it.
const PAID_BACKUP_OFF = new RegExp(`\\b${PAID_BACKUP_OFF_NOTE}\\b`, 'i')
// The one cron backup that stays free with the paid backup off (plain text).
const FREE_BACKUP_KINDS = new Set<string>(['daily_message'])
// Daytime kinds have no backup at all: an unanswered slot is missed, even
// though the sweep stamps it 'fallback: no fallback …'.
const NO_BACKUP_KINDS = new Set<string>(['pulse', 'reflect'])
// Hourly daytime kinds are not "last night".
const DAYTIME_KINDS = new Set<string>(BRAIN_JOBS.filter((j) => j.cadence === 'hourly').map((j) => j.kind))

// The routine whose scope owns a kind: completeJob overwrites claimed_by, so
// a finished job's routine cannot be read back from the row.
function routineForKind(kind: string): RoutineId | null {
  return ROUTINES.find((r) => (r.allowedKinds as readonly string[]).includes(kind))?.id ?? null
}

export interface ClassifyOptions {
  // The user's paid backup is currently off: a failed/expired job "covered by
  // its cron" was not (the cron skips), except kinds whose backup is free.
  paidBackupOff?: boolean
}

// The routine answered: completeJob writes 'routine'; a claim may carry a
// scope suffix ('routine:brain' / 'routine:chat').
function isRoutineAnswer(claimedBy: string | null): boolean {
  return claimedBy?.startsWith('routine') ?? false
}

// null = not an outcome yet (open, before its deadline) or not owed.
export function classifyBrainJob(row: BrainJobRow, now: Date, options: ClassifyOptions = {}): AnsweredBy | null {
  switch (row.status) {
    case 'done':
      return isRoutineAnswer(row.claimedBy) ? 'routine' : 'backup'
    case 'fallback':
      return 'backup'
    case 'failed':
    case 'expired': {
      const error = row.error?.trim() ?? ''
      if (error.startsWith(SUPERSEDED_PREFIX)) return null
      if (PAID_BACKUP_OFF.test(error)) return 'missed'
      if (NO_BACKUP_KINDS.has(row.kind)) return 'missed'
      if (error.startsWith(FALLBACK_ERROR_PREFIX) || BACKUP_NOTE.test(error)) {
        return options.paidBackupOff && !FREE_BACKUP_KINDS.has(row.kind) ? 'missed' : 'backup'
      }
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

export interface SummariseOptions extends ClassifyOptions {
  // KAIROS_CHAT_ROUTINE (alias KAIROS_TELEGRAM_ROUTINE): when off, the chat
  // routine is 'off' regardless of history.
  chatRoutineFlagOn?: boolean
  // KAIROS_DAYTIME_THINKING: when off, the pulse routine is 'off'. Defaults
  // to the server flag.
  pulseRoutineFlagOn?: boolean
}

// Spend proxy for the "Paid backup" switch: jobs (any kind, chat included)
// answered by the backup over the last 7 days, by the same classification.
// Over-counts free backups (e.g. a plain-text 06:00 message) — good enough.
export function countPaidBackupCalls(rows: readonly BrainJobRow[], now: Date, options: ClassifyOptions = {}): number {
  const weekStart = now.getTime() - BRAIN_STATUS_WINDOW_MS
  return rows.filter((row) => row.deadlineAt.getTime() >= weekStart && classifyBrainJob(row, now, options) === 'backup').length
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
  let pulseLastClaim: Date | null = null
  let chatLatest: { at: Date; by: AnsweredBy } | null = null
  let chatLastClaim: Date | null = null

  for (const row of rows) {
    const by = classifyBrainJob(row, now, options)
    if (!by) continue
    const at = eventTime(row)
    const deadline = row.deadlineAt.getTime()

    if (deadline >= nightStart && !DAYTIME_KINDS.has(row.kind)) lastNight[by] += 1
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
    } else if (claim && routineForKind(row.kind) === 'pulse') {
      if (!pulseLastClaim || claim > pulseLastClaim) pulseLastClaim = claim
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
  // Chat is on demand: it is live when the latest chat turn (web or Telegram) was answered
  // by the routine, silent when the backup or nobody answered it.
  const chatState: BrainRoutineStatus['state'] = !options.chatRoutineFlagOn
    ? 'off'
    : chatLatest?.by === 'routine' ? 'live' : 'silent'
  // The pulse runs only when there was activity, so a quiet day is not silence:
  // live while it claimed within the same 26 h as the brain.
  const pulseState: BrainRoutineStatus['state'] = !(options.pulseRoutineFlagOn ?? daytimeThinkingEnabled())
    ? 'off'
    : pulseLastClaim && now.getTime() - pulseLastClaim.getTime() <= ROUTINE_SILENT_AFTER_MS ? 'live' : 'silent'

  const routines: BrainRoutineStatus[] = [
    { id: 'brain', lastClaimAt: brainLastClaim ? (brainLastClaim as Date).toISOString() : null, state: brainState },
    { id: 'chat', lastClaimAt: chatLastClaim ? (chatLastClaim as Date).toISOString() : null, state: chatState },
    { id: 'pulse', lastClaimAt: pulseLastClaim ? (pulseLastClaim as Date).toISOString() : null, state: pulseState },
  ]

  return { lastNight, backupKinds, kinds, routines }
}

// ── Chat latency (web + Telegram chat routine) ─────────────────────────────

export interface ChatLatencyOptions extends ClassifyOptions {
  // Window over job creation; default the last 7 days up to `now`.
  from?: Date
  to?: Date
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!
}

function timingOf(row: BrainJobRow): Record<string, unknown> | null {
  const t = row.timing
  return t && typeof t === 'object' && !Array.isArray(t) ? (t as Record<string, unknown>) : null
}

function finiteMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

// Routine turns: enqueue → answer (completedAt − createdAt). Backup turns:
// enqueue → settle from the stamped timing (their completedAt is the
// takeover, not the answer). Null when neither is known.
function turnMs(row: BrainJobRow, by: AnsweredBy): number | null {
  if (by === 'routine') {
    return row.createdAt && row.completedAt ? Math.max(0, row.completedAt.getTime() - row.createdAt.getTime()) : null
  }
  return finiteMs(timingOf(row)?.enqueueToSettleMs)
}

// Pure: chat turns created in [from, to]. Percentiles cover routine-answered
// turns only; null when there were no chat turns at all.
export function summariseChatLatency(
  rows: readonly BrainJobRow[],
  now: Date,
  options: ChatLatencyOptions = {},
): KairosChatLatency | null {
  const from = (options.from ?? new Date(now.getTime() - BRAIN_STATUS_WINDOW_MS)).getTime()
  const to = (options.to ?? now).getTime()
  const counts = emptyCounts()
  const routineMs: number[] = []
  const backupMs: number[] = []
  let fireFailures = 0
  let last: { at: number; ms: number | null } | null = null

  for (const row of rows) {
    if (row.kind !== 'chat') continue
    const created = (row.createdAt ?? row.deadlineAt).getTime()
    if (created < from || created > to) continue
    if (timingOf(row)?.fireOk === false) fireFailures += 1
    const by = classifyBrainJob(row, now, options)
    if (!by) continue
    counts[by] += 1
    const ms = turnMs(row, by)
    if (ms !== null && by === 'routine') routineMs.push(ms)
    if (ms !== null && by === 'backup') backupMs.push(ms)
    if (!last || created > last.at) last = { at: created, ms }
  }

  const turns = counts.routine + counts.backup + counts.missed
  if (turns === 0 && fireFailures === 0) return null
  routineMs.sort((a, b) => a - b)
  backupMs.sort((a, b) => a - b)
  return {
    turns,
    routine: counts.routine,
    backup: counts.backup,
    missed: counts.missed,
    p50Ms: percentile(routineMs, 0.5),
    p95Ms: percentile(routineMs, 0.95),
    maxMs: routineMs.length > 0 ? routineMs[routineMs.length - 1]! : null,
    backupP50Ms: percentile(backupMs, 0.5),
    lastTurnMs: last?.ms ?? null,
    fireFailures,
  }
}

// ── Set up Kairos checklist signals ─────────────────────────────────────────
// Four small aggregate selects, each scoped to the user and run in parallel.

// A claude.ai connector counts as working when one of its tokens was used
// this recently (lastUsedAt is written at most once a minute).
export const CONNECTOR_USED_WINDOW_MS = 7 * DAY_MS
// Coding-session captures older than this don't prove the hook still works.
export const SESSION_CAPTURE_WINDOW_MS = 90 * DAY_MS

const SESSION_TOOLS = ['claude', 'codex', 'copilot'] as const
type SessionTool = (typeof SESSION_TOOLS)[number]

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

async function latestConnectorUse(userId: string, since: Date): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(oauthAccessTokens.lastUsedAt) })
    .from(oauthAccessTokens)
    .where(and(
      eq(oauthAccessTokens.userId, userId),
      isNull(oauthAccessTokens.revokedAt),
      gte(oauthAccessTokens.lastUsedAt, since),
    ))
  return row?.at ?? null
}

// The capture hooks write type=session_summary with source=claude|codex|copilot;
// an older server rejected codex/copilot, so those retried as source=hook with
// the tool kept in sourceMetadata.client (same filter as chat-recency-context).
const sessionTool = sql<string>`case when ${memories.source} = 'hook' then ${memories.sourceMetadata}->>'client' else ${memories.source} end`

async function latestSessionsByTool(userId: string, since: Date): Promise<Array<{ tool: string; at: Date | null }>> {
  return db
    .select({ tool: sessionTool, at: max(memories.createdAt) })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'session_summary'),
      gte(memories.createdAt, since),
      sql`(${memories.source} in ('claude', 'codex', 'copilot') or (${memories.source} = 'hook' and ${memories.sourceMetadata}->>'client' in ('codex', 'copilot')))`,
    ))
    .groupBy(sessionTool)
}

// Voice-note segments are staged as inbound proposals carrying
// sourceMetadata.voiceNote (lib/data/voice-notes.ts). Archived ones count:
// the signal is "a voice note was ever staged".
async function latestVoiceNote(userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(memories.createdAt) })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'inbound'),
      sql`${memories.sourceMetadata}->'voiceNote' IS NOT NULL`,
    ))
  return row?.at ?? null
}

// Boards the user owns with a valid feed mode — same rule as parseKairosFeed.
async function countWatchedBoards(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(projects)
    .where(and(
      eq(projects.userId, userId),
      sql`lower(trim(${projects.settings}->>'kairosFeed')) in ('daily', 'weekly')`,
      notArchivedSql,
    ))
  return Number(row?.n ?? 0)
}

export interface SetupSignalOptions {
  // Telegram is configured once, for the operator; nobody else sees it ✓.
  isOperator?: boolean
  now?: Date
}

export async function getSetupSignals(userId: string, options: SetupSignalOptions = {}): Promise<KairosSetupSignals> {
  const now = options.now ?? new Date()
  const [connectorAt, sessionRows, voiceAt, watchedBoards] = await Promise.all([
    latestConnectorUse(userId, new Date(now.getTime() - CONNECTOR_USED_WINDOW_MS)),
    latestSessionsByTool(userId, new Date(now.getTime() - SESSION_CAPTURE_WINDOW_MS)),
    latestVoiceNote(userId),
    countWatchedBoards(userId),
  ])
  const sessions: KairosSetupSignals['sessions'] = { claude: null, codex: null, copilot: null }
  for (const row of sessionRows) {
    if (!(SESSION_TOOLS as readonly string[]).includes(row.tool)) continue
    const at = iso(row.at)
    const tool = row.tool as SessionTool
    if (at && (!sessions[tool] || at > sessions[tool]!)) sessions[tool] = at
  }
  return {
    connectorUsedAt: iso(connectorAt),
    sessions,
    voiceNoteAt: iso(voiceAt),
    watchedBoards,
    telegramConfigured: Boolean(options.isOperator) && telegramConfigured(),
  }
}
