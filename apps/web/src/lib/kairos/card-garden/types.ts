import { z } from 'zod'

// Card garden (Workforce Phase 3): weekly finish / park / merge / kill
// proposals for stale cards, decided by the owner's tap. PROPOSAL ONLY: one
// action per card, at most CARD_GARDEN_MAX_PROPOSALS a week, nothing changes
// until the owner approves. "merge" never fuses cards: fusion stays app-only.
export const CARD_GARDEN_KIND = 'card_garden' as const
export const CARD_GARDEN_MAX_PROPOSALS = 10
export const CARD_GARDEN_MAX_CANDIDATES = 25
export const CARD_GARDEN_STALE_DAYS = 21
export const CARD_GARDEN_REASON_MAX = 300
export const CARD_GARDEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

export const CARD_GARDEN_ACTIONS = ['finish', 'park', 'merge', 'kill'] as const
export type CardGardenAction = (typeof CARD_GARDEN_ACTIONS)[number]

// A column whose cards are parked already (park target) or finished.
export const PARK_COLUMN_RE = /backlog|cryo|icebox|parked/i
const DONE_COLUMN_NAMES: readonly string[] = ['done', 'vault']

export function pickParkColumn<T extends { name: string }>(columns: readonly T[]): T | null {
  return columns.find((c) => PARK_COLUMN_RE.test(c.name)) ?? null
}

export function pickDoneColumn<T extends { name: string }>(columns: readonly T[]): T | null {
  return columns.find((c) => DONE_COLUMN_NAMES.includes(c.name.trim().toLowerCase())) ?? null
}

const loose = <T extends z.ZodType>(schema: T, fallback: z.output<T>) => schema.catch(fallback)
const idString = z.union([z.string(), z.number()]).transform((v) => String(v).trim())

export const cardGardenAnswerSchema = z.object({
  proposals: z.array(z.object({
    taskId: idString,
    action: z.string(),
    mergeWithTaskId: loose(idString.nullable().optional(), null),
    reason: loose(z.string(), ''),
  })),
})
export type CardGardenAnswer = z.infer<typeof cardGardenAnswerSchema>

const contextCardSchema = z.object({
  taskId: z.string().min(1),
  name: z.string(),
  projectId: z.string().min(1),
  columnName: z.string().nullable(),
  ageDays: z.number().int().min(0),
})

const contextBoardSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string(),
  parkColumn: z.string().nullable(),
  doneColumn: z.string().nullable(),
})

export const cardGardenContextSchema = z.object({
  v: z.literal(1),
  isoWeek: z.string().min(1),
  boards: z.array(contextBoardSchema),
  cards: z.array(contextCardSchema).max(CARD_GARDEN_MAX_CANDIDATES),
})
export type CardGardenContext = z.infer<typeof cardGardenContextSchema>
export type CardGardenContextCard = z.infer<typeof contextCardSchema>
export type CardGardenContextBoard = z.infer<typeof contextBoardSchema>

// One grounded proposal: the card, its board, the action and why.
export const storedCardGardenSchema = z.object({
  isoWeek: z.string(),
  taskId: z.string().min(1),
  taskName: z.string(),
  projectId: z.string().min(1),
  projectName: z.string(),
  columnName: z.string().nullable(),
  ageDays: z.number().int().min(0),
  action: z.enum(CARD_GARDEN_ACTIONS),
  reason: z.string(),
  mergeWith: z.object({ taskId: z.string().min(1), name: z.string() }).nullable(),
  parkColumn: z.string().nullable(),
  doneColumn: z.string().nullable(),
})
export type CardGardenPick = z.infer<typeof storedCardGardenSchema>

/** The pick on a proposal row, or null when it is missing or malformed. */
export function readCardGarden(sourceMetadata: unknown): CardGardenPick | null {
  const meta = sourceMetadata && typeof sourceMetadata === 'object' ? (sourceMetadata as Record<string, unknown>) : {}
  if (meta.kind !== CARD_GARDEN_KIND) return null
  const parsed = storedCardGardenSchema.safeParse(meta.cardGarden)
  return parsed.success ? parsed.data : null
}
