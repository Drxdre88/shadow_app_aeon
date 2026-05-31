import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { runProjectSnapshotsForUser } from '@/lib/kairos/project-snapshot'

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
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const users = await db
    .selectDistinct({ userId: projects.userId })
    .from(projects)

  const userResults: Array<{
    userId: string
    results: Awaited<ReturnType<typeof runProjectSnapshotsForUser>>
    error?: string
  }> = []

  for (const { userId } of users) {
    try {
      const results = await runProjectSnapshotsForUser(userId)
      userResults.push({ userId, results })
    } catch (err) {
      userResults.push({ userId, results: [], error: err instanceof Error ? err.message : String(err) })
    }
  }

  const totalCreated = userResults.reduce(
    (n, u) => n + u.results.filter((r) => r.status === 'created').length,
    0,
  )

  return NextResponse.json({
    ran: users.length,
    snapshotsCreated: totalCreated,
    users: userResults,
  })
}
