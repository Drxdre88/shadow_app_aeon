import type { Origin } from './origin'
import { recordTodayAfter } from './today'

// Staging surfaces (MCP kairos_voice_note, REST voice-notes) log a staged
// voice note once per noteId (spec_one_mind). The words stay unconfirmed —
// agent speaker — until the owner confirms them in the inbox, which logs its
// own voice_confirmed entry (voice-note-confirm.ts). Fire-and-forget: never
// delays the tool response. Kept apart from the confirm module so connector
// surfaces never import the accept path.
export function recordVoiceStagedToday(userId: string, noteId: string, parts: number, transcript: string, origin: Origin): void {
  recordTodayAfter(
    userId,
    {
      key: `voice:${noteId}:staged`,
      channel: 'voice',
      type: 'voice_staged',
      text: `Voice note staged (${parts} part${parts === 1 ? '' : 's'}, awaiting confirmation): ${transcript}`,
    },
    origin,
  )
}
