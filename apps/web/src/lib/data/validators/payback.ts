import { z } from 'zod'

// Read schema shared by the get_agent_payback MCP tool, GET /api/v1/hangar/payback
// and the Velocity tab's server action.

export const PAYBACK_PERIODS = ['7d', '30d', '90d', 'all'] as const
export const PAYBACK_GROUPS = ['repo', 'engine', 'model'] as const

export const getAgentPaybackSchema = z.object({
  period: z.enum(PAYBACK_PERIODS).default('30d'),
  projectId: z.string().uuid().optional(),
  // Omitted = every breakdown; set = only that one.
  groupBy: z.enum(PAYBACK_GROUPS).optional(),
  format: z.enum(['json', 'markdown']).default('json'),
})

export type GetAgentPaybackInput = z.infer<typeof getAgentPaybackSchema>
export type PaybackPeriod = (typeof PAYBACK_PERIODS)[number]
export type PaybackGroup = (typeof PAYBACK_GROUPS)[number]
