import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit } from '@/lib/api/rateLimit'
import { jsonResponse } from '@/lib/api/response'
import { SSE_HEADERS } from '@/lib/kairos/voice/turn-stream'
import { VOICE_TURN_LIMIT } from '@/lib/kairos/voice/limits'
import {
  findOrCreateVoiceThread,
  findVoiceTurnInProgress,
  resolveVoicePaidKey,
  voiceTurnSchema,
  voiceTurnStream,
} from '@/lib/kairos/voice/turn'

// Voice line — POST /api/v1/kairos/voice/turn. One Vorath chat turn for the
// owner's desk app, streamed as text/event-stream (docs/kairos/voice-api.md).
// Auxiliary owner-only route, outside the MCP/REST parity invariant like
// kairos/speak: a delivery channel, not a data tool. Paid key only; the Max
// routine is never used, and no paid key is a 409.

// Retrieval + up to 45s of tool loop + the reply; well under Vercel's limit.
export const maxDuration = 120

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const denied = vorathGuard(auth)
    if (denied) return denied

    const body = await request.json().catch(() => null)
    const parsed = voiceTurnSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const paid = await resolveVoicePaidKey(auth.id)
    if (!paid.ok) return jsonResponse({ error: paid.message, code: paid.code }, { status: 409 })

    // Checked before any write: an unanswered turn still being answered owns
    // the thread; a second one would be merged into it by the engine.
    if (await findVoiceTurnInProgress(auth.id, parsed.data.threadKey)) {
      return jsonResponse({ error: 'Vorath is still answering the previous turn', code: 'turn_in_progress' }, { status: 409 })
    }

    const threadId = await findOrCreateVoiceThread(auth.id, parsed.data.threadKey)
    if (!threadId) return jsonError('Could not open the voice thread', 500)

    return new Response(voiceTurnStream(auth.id, threadId, parsed.data.text, paid.provider), {
      status: 200,
      headers: SSE_HEADERS,
    })
  }),
  VOICE_TURN_LIMIT,
)
