import { z } from 'zod'

// Read schema shared by the get_card_forecast MCP tool and GET /api/v1/projects/[id]/forecast.

export const getCardForecastSchema = z.object({
  projectId: z.string().uuid(),
  // Omitted = every dated or estimated open card on the board.
  taskId: z.string().uuid().optional(),
})

export type GetCardForecastInput = z.infer<typeof getCardForecastSchema>
