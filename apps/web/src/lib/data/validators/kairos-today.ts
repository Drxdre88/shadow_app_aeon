import { z } from 'zod'

// Kairos "today" — one rolling cross-channel log per user (spec_one_mind).
// The read schema is shared verbatim by the get_kairos_today MCP tool and
// GET /api/v1/kairos/today (locked by kairos-today-parity.test.ts). Entries are
// written only by the server; there is no write schema on any public surface.

export const TODAY_CHANNELS = ['web', 'telegram', 'triad', 'mcp', 'voice', 'session', 'inbox', 'ask', 'kairos'] as const
export const TODAY_TYPES = [
  'said', 'replied', 'decided', 'answered', 'used', 'captured', 'spoke', 'voice_staged', 'voice_confirmed', 'noted',
] as const
export const TODAY_SPEAKERS = ['owner', 'kairos', 'agent'] as const
export const TODAY_COVERED = ['chat-distill', 'ask-reflection', 'voice-accept', 'memory', 'dialogue-commit'] as const
export const TODAY_CLIENT_KINDS = ['oauth', 'api_key', 'mobile', 'master'] as const

export const TODAY_RETENTION_HOURS = 36
export const TODAY_MAX_ENTRIES = 500
export const TODAY_MAX_LIST = 200
export const TODAY_KEY_MAX = 200
export const TODAY_TEXT_MAX = 400
export const TODAY_GIST_MAX = 160
export const TODAY_SAMPLE_MAX = 120
export const TODAY_SAMPLES_MAX = 3

export const todayChannelSchema = z.enum(TODAY_CHANNELS)
export const todayTypeSchema = z.enum(TODAY_TYPES)

export type TodayChannel = z.infer<typeof todayChannelSchema>
export type TodayType = z.infer<typeof todayTypeSchema>
export type TodaySpeaker = (typeof TODAY_SPEAKERS)[number]
export type TodayCovered = (typeof TODAY_COVERED)[number]
export type TodayClientKind = (typeof TODAY_CLIENT_KINDS)[number]

export const getKairosTodaySchema = z.object({
  hours: z.coerce.number().int().min(1).max(TODAY_RETENTION_HOURS).default(24),
  channel: todayChannelSchema.optional(),
  limit: z.coerce.number().int().min(1).max(TODAY_MAX_LIST).default(100),
  format: z.enum(['json', 'markdown']).default('json'),
})

export type GetKairosTodayInput = z.infer<typeof getKairosTodaySchema>
