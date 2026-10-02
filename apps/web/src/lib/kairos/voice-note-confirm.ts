import { isConfirmableSegment, listVoiceNoteSegments } from '@/lib/data/voice-notes'
import type { Origin } from './origin'
import { acceptKairosProposal } from './proposal-accept'

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
    const res = await acceptKairosProposal(segment.id, userId, { pin: false }, { origin: OWNER_ACCEPT })
    if (res?.ok) accepted++
  }
  return { noteId, parts: segments[0].voiceNote.of, accepted }
}
