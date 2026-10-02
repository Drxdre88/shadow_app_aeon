import { stageVoiceNote } from '@/lib/data/voice-notes'
import { kairosVoiceNoteSchema } from '@/lib/data/validators/voice-notes'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// kairos_voice_note — the owner's long dictation from claude.ai. The words are
// staged verbatim as pending reflection proposals (agent origin); they count
// as the owner's own words only after the owner confirms them in the Aeon
// inbox. There is deliberately no MCP confirm. Shares validator + fn with
// POST /api/v1/kairos/voice-notes (voice-notes-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerVoiceNoteTools: RegisterFn = (server) => {
  server.tool(
    'kairos_voice_note',
    'Send the operator\'s voice note (dictation) to Kairos. Use when the operator says "note for Kairos" or dictates a note to Kairos. ' +
      'Pass their words EXACTLY as transcribed in transcript — no rewording, tidying or summarising beyond removing filler like "um". ' +
      'Put any summary of your own only in claudeSummary. If they name an area, find it with list_dominions and pass its id as dominionId. ' +
      'The note waits for the operator\'s one-tap confirmation in the Kairos inbox; tell them so.',
    kairosVoiceNoteSchema.shape,
    { title: 'Kairos Voice Note', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = kairosVoiceNoteSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const result = await stageVoiceNote(uid, parsed.data, { source: 'claude', via: 'mcp' })
      if (!result.ok) {
        if (result.reason === 'dominion_not_found') return notFound('Dominion')
        return fail(`kairos_voice_note: ${result.reason}`)
      }
      return ok({
        noteId: result.noteId,
        parts: result.parts,
        created: result.created,
        proposalIds: result.proposalIds,
        summaryId: result.summaryId,
        status: 'waiting for the operator\'s one-tap confirmation in the Kairos inbox',
      })
    },
  )
}
