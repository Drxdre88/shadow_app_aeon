import { isConfirmableSegment, listVoiceNoteSegments } from '@/lib/data/voice-notes'
import type { Origin } from './origin'
import { acceptKairosProposal } from './proposal-accept'
import { recordToday } from './today'

// One-tap confirm of a whole voice note: every still-pending segment goes
// through the same accept path as an inbox tap (acceptKairosProposal), so each
// becomes an operator/accept reflection with the operator reactions applied.
// Only owner-session surfaces may call this — never the connector.

export interface ConfirmVoiceNoteResult {
  noteId: string
  parts: number
  accepted: number
}

const OWNER_ACCEPT: Origin = { kind: 'operator', via: 'accept' }

export async function confirmVoiceNote(userId: string, noteId: string): Promise<ConfirmVoiceNoteResult | null> {
  const segments = await listVoiceNoteSegments(userId, noteId)
  if (segments.length === 0) return null
  let accepted = 0
  for (const segment of segments.filter(isConfirmableSegment)) {
    // recordToday:false — the note is logged once below, not once per segment.
    const res = await acceptKairosProposal(segment.id, userId, { pin: false }, { origin: OWNER_ACCEPT, recordToday: false })
    if (res?.ok) accepted++
  }
  const parts = segments[0].voiceNote.of
  if (accepted > 0) {
    await recordToday(
      userId,
      {
        key: `voice:${noteId}:confirmed`,
        channel: 'voice',
        type: 'voice_confirmed',
        text: `Confirmed voice note: ${accepted} of ${parts} part${parts === 1 ? '' : 's'} accepted`,
        covered: 'voice-accept',
      },
      OWNER_ACCEPT,
    )
  }
  return { noteId, parts, accepted }
}
