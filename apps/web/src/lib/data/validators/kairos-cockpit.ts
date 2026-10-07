import { z } from 'zod'

// Read schema shared by the get_morning_cockpit MCP tool and GET /api/v1/kairos/cockpit.

export const getMorningCockpitSchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
})

export type GetMorningCockpitInput = z.infer<typeof getMorningCockpitSchema>
