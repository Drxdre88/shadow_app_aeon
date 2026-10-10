import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit } from '@/lib/api/rateLimit'
import { jsonResponse } from '@/lib/api/response'
import { buildVoiceFeed, parseVoiceFeedParams } from '@/lib/kairos/voice/feed'
import { loadVoiceFeedRows } from '@/lib/kairos/voice/feed-query'

// Voice line — GET /api/v1/kairos/voice/feed?since=<ISO>&limit=. The desk
// app's alert feed, polled every 5s (docs/kairos/voice-api.md): Morghul
// relays and Vorath's own questions only. Read-only: no Telegram, no read
// marks, never arms awaiting-reply. Auxiliary owner-only route outside the
// MCP/REST parity invariant, like kairos/speak.

// A 5s poll is 12 a minute; 20 leaves room for a retry or a second window.
const VOICE_FEED_LIMIT = { windowMs: 60_000, maxRequests: 20 }

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const denied = vorathGuard(auth)
    if (denied) return denied

    const now = new Date()
    const params = parseVoiceFeedParams(request.nextUrl.searchParams, now)
    if (!params.ok) return jsonError(params.error, 400)

    const rows = await loadVoiceFeedRows(auth.id, params.window)
    return jsonResponse(buildVoiceFeed(rows, params.window, now), {
      headers: { 'Cache-Control': 'no-store' },
    })
  }),
  VOICE_FEED_LIMIT,
)
