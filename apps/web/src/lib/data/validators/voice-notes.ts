import { z } from 'zod'

// Voice-note validators — shared verbatim by the kairos_voice_note MCP tool and
// POST /api/v1/kairos/voice-notes (locked by voice-notes-parity.test.ts).

export const VOICE_NOTE_TRANSCRIPT_MAX = 100_000
export const VOICE_NOTE_CLAUDE_SUMMARY_MAX = 2_000

export const kairosVoiceNoteSchema = z.object({
  transcript: z
    .string()
    .max(VOICE_NOTE_TRANSCRIPT_MAX)
    .refine((s) => s.trim().length > 0, 'transcript is empty')
    .describe('The owner\'s words exactly as transcribed — no rewording or tidying beyond removing filler like "um".'),
  dominionId: z.string().uuid().nullish().describe('Optional Dominion (area) UUID from list_dominions'),
  claudeSummary: z
    .string()
    .trim()
    .min(1)
    .max(VOICE_NOTE_CLAUDE_SUMMARY_MAX)
    .optional()
    .describe('Optional summary in your own words. Stored apart from the transcript; never counted as the owner\'s words.'),
})

export type KairosVoiceNoteInput = z.infer<typeof kairosVoiceNoteSchema>
