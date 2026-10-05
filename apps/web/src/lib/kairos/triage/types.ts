import { z } from 'zod'

// Card sorting ("Vorath sorts new cards"): suggestions Vorath leaves on a new
// card's metadata.triage. Nothing is applied until the owner accepts an item.

export const CARD_TRIAGE_KIND = 'card_triage' as const
// projects.settings key; only 'on' counts. Changed only by the owner-only switch.
export const CARD_TRIAGE_SETTING = 'kairosTriage' as const

export const TRIAGE_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type TriagePriority = (typeof TRIAGE_PRIORITIES)[number]

export const TRIAGE_ITEM_STATUSES = ['pending', 'accepted', 'dismissed'] as const
export type TriageItemStatus = (typeof TRIAGE_ITEM_STATUSES)[number]

export const TRIAGE_REASON_MAX = 200
export const TRIAGE_NAME_MAX = 120

const status = z.enum(TRIAGE_ITEM_STATUSES)
const reason = z.string().max(TRIAGE_REASON_MAX + 1)

export const triageLabelSchema = z.object({ id: z.string().min(1), reason, status })
export const triagePrioritySchema = z.object({ value: z.enum(TRIAGE_PRIORITIES), reason, status })
export const triageDuplicateSchema = z.object({
  taskId: z.string().min(1),
  name: z.string().max(TRIAGE_NAME_MAX + 1),
  reason,
  status,
})

export const cardTriageSchema = z.object({
  v: z.literal(1),
  jobId: z.string().min(1),
  at: z.string().min(1),
  labels: z.array(triageLabelSchema).default([]),
  priority: triagePrioritySchema.nullable().default(null),
  duplicates: z.array(triageDuplicateSchema).default([]),
})

export type CardTriage = z.infer<typeof cardTriageSchema>
export type TriageLabel = z.infer<typeof triageLabelSchema>
export type TriageDuplicate = z.infer<typeof triageDuplicateSchema>

export type TriageItemKind = 'label' | 'priority' | 'duplicate'
export type TriageDecision = 'accept' | 'dismiss'

export const resolveTriageInputSchema = z.object({
  kind: z.enum(['label', 'priority', 'duplicate']),
  ref: z.string().max(64).optional(),
  decision: z.enum(['accept', 'dismiss']),
})
export type ResolveTriageInput = z.infer<typeof resolveTriageInputSchema>

export const setCardTriageInputSchema = z.object({ on: z.boolean() })

// The stored triage on a card, or null when absent or malformed.
export function readCardTriage(metadata: unknown): CardTriage | null {
  if (!metadata || typeof metadata !== 'object') return null
  const parsed = cardTriageSchema.safeParse((metadata as Record<string, unknown>).triage)
  return parsed.success ? parsed.data : null
}

export function isCardTriageOn(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false
  return (settings as Record<string, unknown>)[CARD_TRIAGE_SETTING] === 'on'
}

export function isTriagePriority(v: unknown): v is TriagePriority {
  return typeof v === 'string' && (TRIAGE_PRIORITIES as readonly string[]).includes(v)
}
