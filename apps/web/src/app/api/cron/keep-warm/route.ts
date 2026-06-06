import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

// Keep-warm cron — fires every few minutes to issue a trivial `SELECT 1` so the
// Neon compute never idles past its scale-to-zero window (default 5 min). This
// turns the first user request after a quiet spell from a cold-start (compute
// resume + WebSocket handshake, the trigger behind pool waits and dropped
// responses under burst) into a warm sub-100ms query. Cheap stopgap; the
// durable alternative is disabling scale-to-zero on the Neon plan.

export const dynamic = 'force-dynamic'
export const maxDuration = 15

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const startedAt = Date.now()
  try {
    await db.execute(sql`SELECT 1`)
    return NextResponse.json({ ok: true, warmMs: Date.now() - startedAt })
  } catch (err) {
    // A failure here is non-fatal (the next real request will still wake the
    // compute) but worth a 503 so the cron run is visibly red in Vercel logs.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), warmMs: Date.now() - startedAt },
      { status: 503 },
    )
  }
}
