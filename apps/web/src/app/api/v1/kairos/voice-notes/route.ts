import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { stageVoiceNote } from '@/lib/data/voice-notes'
import { kairosVoiceNoteSchema } from '@/lib/data/validators/voice-notes'
import { recordVoiceStagedToday } from '@/lib/kairos/voice-note-today'

// Mirrors the kairos_voice_note MCP tool through the same validator + fn
// (voice-notes-parity.test.ts). Stages pending proposals only — the note
// counts as the owner's words once confirmed in the Aeon inbox.

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }
    const parsed = kairosVoiceNoteSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const isBearer = request.headers.get('authorization')?.startsWith('Bearer ') ?? false
    const staged = await stageVoiceNote(result.id, parsed.data, isBearer
      ? { source: 'claude', via: 'rest' }
      : { source: 'manual', via: 'rest-session' })
    if (!staged.ok) {
      return staged.reason === 'dominion_not_found' ? jsonError('Dominion not found', 404) : jsonError(staged.reason, 400)
    }
    // Staged words are never the owner's until confirmed: agent speaker on both auth modes.
    recordVoiceStagedToday(result.id, staged.noteId, staged.parts, parsed.data.transcript, {
      kind: 'agent',
      via: isBearer ? 'rest' : 'rest-session',
    })
    return jsonData(
      { noteId: staged.noteId, parts: staged.parts, created: staged.created, proposalIds: staged.proposalIds, summaryId: staged.summaryId },
      staged.created ? 201 : 200,
    )
  }),
  API_WRITE_LIMIT
)
