import { NextRequest } from 'next/server'
import { jsonResponse } from '@/lib/api/response'
import { reconcileHangarSessions } from '@/lib/data/hangar-reconcile'

// Hangar stall reconciler — every 15 minutes. Settles running missions whose
// runner went silent as 'timeout' (card to Tower) and flags long-unclaimed
// queued missions as "runner offline". Idempotent: settled rows drop out.

export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization')
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
  const report = await reconcileHangarSessions()
  return jsonResponse(report)
}
