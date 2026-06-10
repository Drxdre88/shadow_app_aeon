import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dominions } from '@/lib/db/schema'
import { isNull } from 'drizzle-orm'
import { runAetherForUser } from '@/lib/kairos/aether'

// Aether cron — 03:15 UTC daily (after cortex-regen at 03:00). Idempotent.

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization')
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const usersWithDominions = await db
    .selectDistinct({ userId: dominions.userId })
    .from(dominions)
    .where(isNull(dominions.archivedAt))

  if (usersWithDominions.length === 0) {
    return NextResponse.json({ ran: 0, generated: 0, users: [] })
  }

  const userResults: Array<{
    userId: string
    generated: boolean
    error?: string
  }> = []

  for (const { userId } of usersWithDominions) {
    try {
      const result = await runAetherForUser(userId)
      userResults.push({ userId, generated: result.generated })
    } catch (err) {
      userResults.push({
        userId,
        generated: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    ran: userResults.length,
    generated: userResults.filter((r) => r.generated).length,
    users: userResults,
  })
}
