import { z } from 'zod'

// Kairos idea shelf (wave 3 lane C, incubation). Stored as the server-owned
// `kairosIdeaShelf` key in user_preferences.preferences and written only
// through mutateKairosIdeaShelf. Bookkeeping only: the idea text stays on
// the archived idea_candidate memory row the item points at.

export const SHELF_MAX_ITEMS = 40
export const SHELF_MAX_OFFERS = 3
export const SHELF_MAX_BYTES = 12_000

const iso = z.string().min(1).max(40)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const shelfItemSchema = z.object({
  // Archived idea_candidate memory id.
  id: z.string().min(1).max(100),
  offers: z.number().int().min(0).max(SHELF_MAX_OFFERS),
  lastOfferedAt: iso.nullable(),
  // The pulse slot (externalKey) of the last offer.
  slot: z.string().min(1).max(100).nullable(),
  resurfacedAt: iso.nullable(),
  fadedAt: iso.nullable(),
}).strict()

export const kairosIdeaShelfSchema = z.object({
  v: z.literal(1),
  items: z.array(shelfItemSchema).max(SHELF_MAX_ITEMS),
  // London YYYY-MM-DD of the last resurface (≤1 per London day).
  lastResurfaceDay: day.nullable(),
}).strict().refine((s) => JSON.stringify(s).length <= SHELF_MAX_BYTES, `kairosIdeaShelf exceeds ${SHELF_MAX_BYTES} bytes`)

export type ShelfItem = z.infer<typeof shelfItemSchema>
export type KairosIdeaShelf = z.infer<typeof kairosIdeaShelfSchema>
