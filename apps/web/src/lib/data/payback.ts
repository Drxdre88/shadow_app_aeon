import { db } from '@/lib/db'
import { agentSessions, boardTasks, projects } from '@/lib/db/schema'
import { and, eq, gte, isNotNull, notInArray, sql } from 'drizzle-orm'
import { verifyProjectAccess } from './projects'
import type { PaybackGroup, PaybackPeriod } from './validators/payback'

// Hangar payback ledger — READ ONLY. What the user's card missions cost and
// how they ended. Missing cost is reported as unknown, never as zero, and a
// mission the runner lost (timed out / killed) is its own category, not a failure.

export const PAYBACK_INTERNAL_ENGINES = ['kairos-chat', 'kairos-dialogue', 'kairos-today'] as const
// 'timeout' = reconciler settled a silent running mission (hangar-reconcile.ts);
// 'killed' = the process was stopped (SIGTERM, out of memory, kill request).
export const RUNNER_DIED_STATUSES: ReadonlySet<string> = new Set(['timeout', 'killed'])
export const DEFAULT_MODEL_KEY = 'default'
export const TOP_CARDS_LIMIT = 10

const PERIOD_DAYS: Record<Exclude<PaybackPeriod, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 }
const INTERNAL: ReadonlySet<string> = new Set(PAYBACK_INTERNAL_ENGINES)

export class PaybackAccessError extends Error {
  constructor() {
    super('Project not found or unauthorized')
    this.name = 'PaybackAccessError'
  }
}

export interface PaybackRow {
  sessionId: string
  taskId: string | null
  engine: string
  repo: string | null
  status: string
  costUsd: string | number | null
  startedAt: Date | null
  endedAt: Date | null
  model: string | null
  cardName: string | null
  boardName: string | null
}

export interface PaybackTally {
  missions: number
  succeeded: number
  failed: number
  runnerDied: number
  running: number
  queued: number
  costKnownUsd: number
  missionsWithUnknownCost: number
  totalDurationMin: number
  costPerSucceeded: number | null
}

export interface PaybackBucket extends PaybackTally {
  key: string
}

export interface PaybackTopCard {
  taskId: string
  cardName: string
  boardName: string | null
  missions: number
  costKnownUsd: number
}

export interface PaybackView {
  period: PaybackPeriod
  since: string | null
  projectId: string | null
  totals: PaybackTally
  breakdowns: Partial<Record<PaybackGroup, PaybackBucket[]>>
  topCards: PaybackTopCard[]
}

export interface PaybackOptions {
  period: PaybackPeriod
  projectId?: string
  groupBy?: PaybackGroup
}

export function paybackSince(period: PaybackPeriod, now: Date = new Date()): Date | null {
  if (period === 'all') return null
  return new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000)
}

const round2 = (n: number) => Math.round(n * 100) / 100

function parseCost(value: string | number | null): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

class TallyBuilder {
  private t = { missions: 0, succeeded: 0, failed: 0, runnerDied: 0, running: 0, queued: 0, cost: 0, unknown: 0, durationMs: 0, succeededWithCost: 0 }

  add(row: PaybackRow): void {
    const t = this.t
    const cost = parseCost(row.costUsd)
    t.missions++
    if (row.status === 'succeeded') t.succeeded++
    else if (row.status === 'failed') t.failed++
    else if (RUNNER_DIED_STATUSES.has(row.status)) t.runnerDied++
    else if (row.status === 'running') t.running++
    else if (row.status === 'queued') t.queued++
    if (cost === null) t.unknown++
    else {
      t.cost += cost
      if (row.status === 'succeeded') t.succeededWithCost++
    }
    if (row.startedAt && row.endedAt) t.durationMs += Math.max(0, row.endedAt.getTime() - row.startedAt.getTime())
  }

  build(): PaybackTally {
    const t = this.t
    return {
      missions: t.missions,
      succeeded: t.succeeded,
      failed: t.failed,
      runnerDied: t.runnerDied,
      running: t.running,
      queued: t.queued,
      costKnownUsd: round2(t.cost),
      missionsWithUnknownCost: t.unknown,
      totalDurationMin: Math.round(t.durationMs / 60_000),
      // All known spend (failed attempts included) per finished mission whose cost is known.
      costPerSucceeded: t.succeededWithCost > 0 ? round2(t.cost / t.succeededWithCost) : null,
    }
  }
}

const GROUP_KEY: Record<PaybackGroup, (row: PaybackRow) => string> = {
  repo: (row) => row.repo || 'no repo',
  engine: (row) => row.engine,
  model: (row) => row.model || DEFAULT_MODEL_KEY,
}

function breakdown(rows: PaybackRow[], group: PaybackGroup): PaybackBucket[] {
  const buckets = new Map<string, TallyBuilder>()
  for (const row of rows) {
    const key = GROUP_KEY[group](row)
    const builder = buckets.get(key) ?? new TallyBuilder()
    builder.add(row)
    buckets.set(key, builder)
  }
  return [...buckets.entries()]
    .map(([key, builder]) => ({ key, ...builder.build() }))
    .sort((a, b) => b.missions - a.missions || b.costKnownUsd - a.costKnownUsd || a.key.localeCompare(b.key))
}

function topCards(rows: PaybackRow[]): PaybackTopCard[] {
  const cards = new Map<string, PaybackTopCard>()
  for (const row of rows) {
    const cost = parseCost(row.costUsd)
    if (!row.taskId || cost === null) continue
    const card = cards.get(row.taskId) ?? { taskId: row.taskId, cardName: row.cardName || 'Deleted card', boardName: row.boardName, missions: 0, costKnownUsd: 0 }
    card.missions++
    card.costKnownUsd += cost
    cards.set(row.taskId, card)
  }
  return [...cards.values()]
    .map((c) => ({ ...c, costKnownUsd: round2(c.costKnownUsd) }))
    .sort((a, b) => b.costKnownUsd - a.costKnownUsd || a.cardName.localeCompare(b.cardName))
    .slice(0, TOP_CARDS_LIMIT)
}

/** Pure: folds mission rows into the payback view; internal engines and card-less rows are dropped. */
export function summarisePayback(rows: PaybackRow[], opts: PaybackOptions & { since: Date | null }): PaybackView {
  const missions = rows.filter((r) => r.taskId !== null && !INTERNAL.has(r.engine))
  const totals = new TallyBuilder()
  for (const row of missions) totals.add(row)
  const groups = opts.groupBy ? [opts.groupBy] : (['repo', 'engine', 'model'] as const)
  const breakdowns: Partial<Record<PaybackGroup, PaybackBucket[]>> = {}
  for (const group of groups) breakdowns[group] = breakdown(missions, group)
  return {
    period: opts.period,
    since: opts.since ? opts.since.toISOString() : null,
    projectId: opts.projectId ?? null,
    totals: totals.build(),
    breakdowns,
    topCards: topCards(missions),
  }
}

export async function listPaybackRows(userId: string, since: Date | null, projectId?: string): Promise<PaybackRow[]> {
  const where = [
    eq(agentSessions.userId, userId),
    isNotNull(agentSessions.taskId),
    notInArray(agentSessions.engine, [...PAYBACK_INTERNAL_ENGINES]),
  ]
  if (since) where.push(gte(agentSessions.spawnedAt, since))
  if (projectId) where.push(eq(agentSessions.projectId, projectId))

  return db
    .select({
      sessionId: agentSessions.id,
      taskId: agentSessions.taskId,
      engine: agentSessions.engine,
      repo: agentSessions.repo,
      status: agentSessions.status,
      costUsd: agentSessions.costUsd,
      startedAt: agentSessions.startedAt,
      endedAt: agentSessions.endedAt,
      model: sql<string | null>`${agentSessions.metadata} -> 'hangar' ->> 'model'`,
      cardName: boardTasks.name,
      boardName: projects.name,
    })
    .from(agentSessions)
    .leftJoin(boardTasks, eq(boardTasks.id, agentSessions.taskId))
    .leftJoin(projects, eq(projects.id, boardTasks.projectId))
    .where(and(...where))
}

/** The payback ledger for the user's missions; throws PaybackAccessError for a project they cannot see. */
export async function readAgentPayback(userId: string, opts: PaybackOptions, now: Date = new Date()): Promise<PaybackView> {
  if (opts.projectId && !(await verifyProjectAccess(opts.projectId, userId))) throw new PaybackAccessError()
  const since = paybackSince(opts.period, now)
  const rows = await listPaybackRows(userId, since, opts.projectId)
  return summarisePayback(rows, { ...opts, since })
}
