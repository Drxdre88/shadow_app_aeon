import { NextRequest, NextResponse } from 'next/server'
import { listChatDistillEligibleUserIds } from '@/lib/data/kairos-chat'
import { runChatDistillForUser, type ChatDistillRunResult } from '@/lib/kairos/chat-distill'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const userIds = await listChatDistillEligibleUserIds()
  const users: Array<{ userId: string; result?: ChatDistillRunResult; error?: string }> = []

  for (const userId of userIds) {
    try {
      users.push({ userId, result: await runChatDistillForUser(userId) })
    } catch (error) {
      await writeCronFailureTrace(userId, {
        cronName: 'chat-distill',
        reason: 'uncaught_exception',
        error,
      })
      users.push({ userId, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return NextResponse.json({
    ran: userIds.length,
    reflectionsCreated: users.reduce(
      (count, user) => count + (user.result?.reflectionsCreated ?? 0),
      0,
    ),
    users,
  })
}
