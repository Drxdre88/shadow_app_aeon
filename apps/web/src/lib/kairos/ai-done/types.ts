import { z } from 'zod'

// AI DONE ("Vorath checks"): each afternoon, on boards whose creator switched
// it on, Vorath files ticked-but-not-done cards for coding work he saw in the
// day's sessions that is not on the board yet. Cards land in an "AI DONE"
// review column, never in Done.

export const AI_DONE_KIND = 'ai_done' as const
// projects.settings key; only boolean true counts. Changed only by the owner-only switch.
export const AI_DONE_SETTING = 'kairosAiDone' as const
export const AI_DONE_COLUMN = 'AI DONE'

export const AI_DONE_MAX_CARDS = 6
export const AI_DONE_MAX_PICKED_LABELS = 2
export const AI_DONE_MAX_GROUPS = 4
export const AI_DONE_MAX_ITEMS = 10
export const AI_DONE_TITLE_MAX = 60
export const AI_DONE_DESCRIPTION_MAX = 140
export const AI_DONE_GROUP_MAX = 40
export const AI_DONE_ITEM_MAX = 70
export const AI_DONE_MAX_BOARDS = 5
export const AI_DONE_MAX_SESSIONS = 40
export const AI_DONE_MAX_BOARD_CARDS = 60

export const setAiDoneInputSchema = z.object({ on: z.boolean() })

export function isAiDoneOn(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false
  return (settings as Record<string, unknown>)[AI_DONE_SETTING] === true
}

const str = z.union([z.string(), z.number()]).transform((v) => String(v)).catch('')
const strList = z.array(str).catch([])

const answerGroupSchema = z.object({ name: str, items: strList })

const answerCardSchema = z.object({
  title: str,
  description: str.optional().catch(undefined),
  repo: str.optional().catch(undefined),
  labels: strList.optional().catch([]),
  groups: z.array(answerGroupSchema.nullable().catch(null)).catch([]),
  sessions: strList,
  alreadyOn: str.nullable().optional().catch(null),
})

const answerBoardSchema = z.object({
  boardHandle: str,
  cards: z.array(answerCardSchema.nullable().catch(null)).catch([]),
})

export const aiDoneAnswerSchema = z.object({
  boards: z.array(answerBoardSchema.nullable().catch(null)),
})
export type AiDoneAnswer = z.infer<typeof aiDoneAnswerSchema>

const contextSessionSchema = z.object({
  h: z.string().min(1),
  id: z.string().min(1),
  repo: z.string().min(1),
  dominion: z.string().nullable(),
})

const contextBoardSchema = z.object({
  h: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string(),
  titles: z.array(z.string()),
  labels: z.array(z.object({ id: z.string().min(1), name: z.string() })),
  sessions: z.array(z.string()),
})

export const aiDoneContextSchema = z.object({
  v: z.literal(1),
  day: z.string().min(1),
  boards: z.array(contextBoardSchema).min(1),
  sessions: z.array(contextSessionSchema),
})
export type AiDoneContext = z.infer<typeof aiDoneContextSchema>
export type AiDoneContextBoard = z.infer<typeof contextBoardSchema>
export type AiDoneContextSession = z.infer<typeof contextSessionSchema>

export interface AiDoneGroup {
  name: string
  items: string[]
}

export interface AiDoneCard {
  title: string
  description: string
  repo: string
  labelIds: string[]
  groups: AiDoneGroup[]
  sessionIds: string[]
}

export interface AiDoneBoardCards {
  projectId: string
  cards: AiDoneCard[]
}

/** Card metadata.aiDone written with every card. */
export interface AiDoneMeta {
  v: 1
  jobId: string
  day: string
  repo: string
  sessionIds: string[]
}

export const normTitle = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
