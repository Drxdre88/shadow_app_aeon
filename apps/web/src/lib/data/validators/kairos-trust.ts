import { z } from 'zod'

// Read schema shared by the get_kairos_trust MCP tool and GET /api/v1/kairos/trust.

export const getKairosTrustSchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
  // Dominion name, topic label or area key (case-insensitive); omitted = every area.
  area: z.string().trim().min(1).max(120).optional(),
})

export type GetKairosTrustInput = z.infer<typeof getKairosTrustSchema>
