import { z } from 'zod'

// L4 Goal → card tree (Workforce). PROPOSAL ONLY: Vorath drafts at most
// CARD_TREE_MAX_CARDS cards for one board from a goal the owner typed; no card
// exists until the owner approves. Only the board's own labels are used.

export const CARD_TREE_KIND = 'card_tree' as const
export const CARD_TREE_MAX_CARDS = 12
export const CARD_TREE_GOAL_MAX = 1000
export const CARD_NAME_MAX = 80
export const CARD_DESCRIPTION_MAX = 400
export const CARD_CHECKLIST_MAX = 6
export const CARD_CHECK_ITEM_MAX = 200
export const CARD_TREE_RATIONALE_MAX = 600
export const CARD_TREE_OPEN_CARDS_MAX = 40
export const CARD_TREE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

export const CARD_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type CardTreePriority = (typeof CARD_PRIORITIES)[number]

const loose = <T extends z.ZodType>(schema: T, fallback: z.output<T>) => schema.catch(fallback)

export const cardTreeAnswerCardSchema = z.object({
  key: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
  name: z.string(),
  description: loose(z.string(), ''),
  priority: loose(z.string(), 'medium'),
  labels: loose(z.array(z.string()), []),
  checklist: loose(z.array(z.string()), []),
  dependsOn: loose(z.array(z.union([z.string(), z.number()]).transform((v) => String(v).trim())), []),
})

export const cardTreeAnswerSchema = z.object({
  rationale: loose(z.string(), ''),
  cards: z.array(cardTreeAnswerCardSchema),
})
export type CardTreeAnswer = z.infer<typeof cardTreeAnswerSchema>

export interface CardTreeCard {
  key: string
  name: string
  description: string
  priority: CardTreePriority
  labels: string[]
  checklist: string[]
  dependsOn: string[]
}

export interface CardTree {
  projectId: string
  projectName: string
  goal: string
  rationale: string
  cards: CardTreeCard[]
}

export const cardTreeContextSchema = z.object({
  v: z.literal(1),
  projectId: z.string().min(1),
  projectName: z.string(),
  goal: z.string().min(1),
  labels: z.array(z.string()),
  openCards: z.array(z.string()),
})
export type CardTreeContext = z.infer<typeof cardTreeContextSchema>

const storedCardSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  priority: z.enum(CARD_PRIORITIES),
  labels: z.array(z.string()),
  checklist: z.array(z.string()),
  dependsOn: z.array(z.string()),
})

export const storedCardTreeSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string(),
  goal: z.string(),
  rationale: z.string(),
  cards: z.array(storedCardSchema).min(1).max(CARD_TREE_MAX_CARDS),
})

/** The tree on a proposal row, or null when it is missing or malformed. */
export function readCardTree(sourceMetadata: unknown): CardTree | null {
  const meta = sourceMetadata && typeof sourceMetadata === 'object' ? (sourceMetadata as Record<string, unknown>) : {}
  if (meta.kind !== CARD_TREE_KIND) return null
  const parsed = storedCardTreeSchema.safeParse(meta.cardTree)
  return parsed.success ? parsed.data : null
}
