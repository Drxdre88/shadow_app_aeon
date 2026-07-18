import { jsonResponse } from '@/lib/api/response'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { runProjectSnapshotsForUser, runEphemeralLifecycleForUser } from '@/lib/kairos/project-snapshot'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'

// Kairos Phase 2 (A5) — nightly project snapshot cron.
// Vercel Cron 23:00 UTC. Iterates every user with at least one project,
// runs the snapshot pass for each.

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })

  const users = await db
    .selectDistinct({ userId: projects.userId })
    .from(projects)

  const userResults: Array<{
    userId: string
    results: Awaited<ReturnType<typeof runProjectSnapshotsForUser>>
    lifecycle?: Awaited<ReturnType<typeof runEphemeralLifecycleForUser>>
    error?: string
  }> = []

  for (const { userId } of users) {
    try {
      const results = await runProjectSnapshotsForUser(userId)
      // Compost the old/misclassified ephemera right after writing today's.
      const lifecycle = await runEphemeralLifecycleForUser(userId)
      userResults.push({ userId, results, lifecycle })
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: 'project-snapshot', reason: 'uncaught_exception', error: err })
      userResults.push({ userId, results: [], error: err instanceof Error ? err.message : String(err) })
    }
  }

  const totalCreated = userResults.reduce(
    (n, u) => n + u.results.filter((r) => r.status === 'created').length,
    0,
  )
  const lifecycle = userResults.reduce(
    (acc, u) => ({
      reclassified: acc.reclassified + (u.lifecycle?.reclassified ?? 0),
      snapshotsArchived: acc.snapshotsArchived + (u.lifecycle?.snapshotsArchived ?? 0),
      advisoriesArchived: acc.advisoriesArchived + (u.lifecycle?.advisoriesArchived ?? 0),
    }),
    { reclassified: 0, snapshotsArchived: 0, advisoriesArchived: 0 },
  )

  return jsonResponse({
    ran: users.length,
    snapshotsCreated: totalCreated,
    lifecycle,
    users: userResults,
  })
}
