import { z } from 'zod'

// Read schema shared by the get_kairos_idea_taste MCP tool and GET /api/v1/kairos/idea-taste.

export const getKairosIdeaTasteSchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
})

export type GetKairosIdeaTasteInput = z.infer<typeof getKairosIdeaTasteSchema>
