import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { memories, dominions } from '@/lib/db/schema'
import { sql, and, eq, isNull } from 'drizzle-orm'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (A4) — weekly memory compaction.
//
// Phase 1A behaviour (now, this commit): count + report. Archives nothing.
// The job runs once per week to produce a per-user / per-Dominion / per-
// stream breakdown so we can see how the substrate is evolving over time.
//
// Phase 1B behaviour (next): absorb old execution-stream memories into
// archetypes, soft-archive the absorbed rows, regenerate cortex docs for
// changed Dominions. See docs/kairos/14-quality-gates.md §6 for the policy.
//
// Auth + cron pattern mirrors apps/web/src/app/api/cron/briefer/route.ts.
// Vercel Cron suggested schedule: weekly Sunday 03:00 UTC. Add to
// vercel.json when wiring up; until then the route is callable manually by
// the owner.
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300

const MIN_AGE_DAYS = Number(process.env.KAIROS_COMPACTION_MIN_AGE_DAYS ?? 30)
const BATCH_SIZE = Number(process.env.KAIROS_COMPACTION_BATCH_SIZE ?? 200)

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization')
  return header === `Bearer ${secret}`
}

interface DominionStreamCount {
  dominionId: string | null
  dominionName: string | null
  streamClass: string
  total: number
  oldEligible: number
}

async function snapshotForUser(userId: string): Promise<DominionStreamCount[]> {
  const rows = await db
    .select({
      dominionId: memories.dominionId,
      dominionName: dominions.name,
      streamClass: memories.streamClass,
      total: sql<number>`COUNT(*)::int`,
      oldEligible: sql<number>`
        COUNT(*) FILTER (
          WHERE ${memories.createdAt} < NOW() - (${MIN_AGE_DAYS}::int * INTERVAL '1 day')
            AND ${memories.archivedAt} IS NULL
            AND ${memories.pinned} = false
            AND ${memories.streamClass} = 'execution'
        )::int`,
    })
    .from(memories)
    .leftJoin(dominions, eq(memories.dominionId, dominions.id))
    .where(and(eq(memories.userId, userId), isNull(memories.archivedAt)))
    .groupBy(memories.dominionId, dominions.name, memories.streamClass)

  return rows.map((r) => ({
    dominionId: r.dominionId,
    dominionName: r.dominionName,
    streamClass: r.streamClass,
    total: r.total,
    oldEligible: r.oldEligible,
  }))
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const usersWithDominions = await db
    .selectDistinct({ userId: dominions.userId })
    .from(dominions)
    .where(isNull(dominions.archivedAt))

  const userIds = usersWithDominions.map((r) => r.userId)
  const startedAt = new Date().toISOString()

  const userReports = await Promise.all(
    userIds.map(async (userId) => {
      try {
        const snapshot = await snapshotForUser(userId)
        const eligible = snapshot.reduce((n, r) => n + r.oldEligible, 0)
        return { userId, status: 'ok' as const, snapshot, eligibleForCompaction: eligible }
      } catch (err) {
        await writeCronFailureTrace(userId, { cronName: 'memory-compaction', reason: 'uncaught_exception', error: err })
        return {
          userId,
          status: 'error' as const,
          snapshot: [],
          eligibleForCompaction: 0,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )

  const totals = userReports.reduce(
    (acc, r) => {
      for (const row of r.snapshot) {
        acc.totalMemories += row.total
        acc.eligibleForCompaction += row.oldEligible
      }
      return acc
    },
    { totalMemories: 0, eligibleForCompaction: 0 },
  )

  return NextResponse.json({
    startedAt,
    finishedAt: new Date().toISOString(),
    phase: '1A-stub',
    note: 'No archival yet — counts only. Phase 1B will absorb eligible execution rows into archetypes.',
    minAgeDays: MIN_AGE_DAYS,
    batchSize: BATCH_SIZE,
    users: userReports.length,
    ...totals,
    perUser: userReports,
  })
}
