import { z } from 'zod'

// Belief ledger reads (docs/kairos/34 §1). Shared verbatim by the list_beliefs /
// get_mind_comparison MCP tools and the /api/v1/kairos/beliefs REST routes
// (locked by beliefs-parity.test.ts).

export const listBeliefsSchema = z.object({
  mind: z.enum(['aligned', 'own']).optional(),
  domain: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['held', 'retired', 'all']).default('held'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const getMindComparisonSchema = z.object({})

export type ListBeliefsInput = z.infer<typeof listBeliefsSchema>
