import { z } from 'zod'
import { KAIROS_VERDICT_DECK_PREF_KEY } from './pref-keys'

// The Sunday verdict deck (Wave 2): one numbered message of everything waiting
// on the owner, answered by reply ("1y 2n 3 skip"). The number → item mapping
// of the latest deck lives in the server-owned `kairosVerdictDeck` preference.

export { KAIROS_VERDICT_DECK_PREF_KEY }
export const VERDICT_DECK_MAX_ITEMS = 10
export const VERDICT_DECK_FOOTER = 'Reply e.g. "1y 2n 3 skip"'

export const DECK_ITEM_KINDS = ['idea', 'ask', 'prediction', 'proposal'] as const
export type DeckItemKind = (typeof DECK_ITEM_KINDS)[number]

// A candidate before numbering: `since` is when it began waiting on the owner.
export interface DeckCandidate {
  kind: DeckItemKind
  id: string
  label: string | null
  title: string
  since: string
}

export const deckItemSchema = z.object({
  n: z.number().int().positive(),
  kind: z.enum(DECK_ITEM_KINDS),
  id: z.string().min(1).max(100),
  label: z.string().max(40).nullable(),
  title: z.string().max(300),
})
export type DeckItem = z.infer<typeof deckItemSchema>

export const verdictDeckSchema = z.object({
  v: z.literal(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  messageIds: z.array(z.number().int()).max(10),
  items: z.array(deckItemSchema).max(VERDICT_DECK_MAX_ITEMS),
})
export type VerdictDeck = z.infer<typeof verdictDeckSchema>

export type DeckVerdict = 'yes' | 'no' | 'skip'
export interface DeckToken { n: number; verdict: DeckVerdict }
