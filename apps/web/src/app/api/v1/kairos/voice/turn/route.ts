import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit } from '@/lib/api/rateLimit'
import { jsonResponse } from '@/lib/api/response'
import { SSE_HEADERS } from '@/lib/kairos/voice/turn-stream'
import { VoiceTurnClock } from '@/lib/kairos/voice/timing'
import { VOICE_TURN_LIMIT } from '@/lib/kairos/voice/limits'
import {
  ensureVoiceThread,
  loadVoiceThreadState,
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
    // Every stage time in done.timing reads from here.
    const clock = new VoiceTurnClock()
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth
    const denied = vorathGuard(auth)
    if (denied) return denied

    const body = await request.json().catch(() => null)
    const parsed = voiceTurnSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    // Both reads at once: the key and the thread state. Nothing is written
    // until both pass, so a missing key or a turn still being answered (a
    // second one would be merged into it by the engine) leaves no trace.
    const [paid, state] = await Promise.all([
      resolveVoicePaidKey(auth.id),
      loadVoiceThreadState(auth.id, parsed.data.threadKey),
    ])
    if (!paid.ok) return jsonResponse({ error: paid.message, code: paid.code }, { status: 409 })
    if (state.inProgress) {
      return jsonResponse({ error: 'Vorath is still answering the previous turn', code: 'turn_in_progress' }, { status: 409 })
    }

    const threadId = await ensureVoiceThread(auth.id, state, parsed.data.threadKey)
    if (!threadId) return jsonError('Could not open the voice thread', 500)
    clock.mark('accepted')

    const stream = voiceTurnStream({
      userId: auth.id,
      threadId,
      text: parsed.data.text,
      provider: paid.provider,
      clock,
      loadedThread: state.threadId === threadId ? state.loaded : null,
    })
    return new Response(stream, {
      status: 200,
      headers: SSE_HEADERS,
    })
  }),
  VOICE_TURN_LIMIT,
)
