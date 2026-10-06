import { z } from 'zod'

// Read schema shared by the get_repo_handover MCP tool and GET /api/v1/kairos/repo-handover.

export const getRepoHandoverSchema = z.object({
  // Board label (aeon, repo:aeon) or repo folder slug (shadow_app_aeon).
  repo: z.string().trim().min(1).max(200),
  format: z.enum(['json', 'markdown']).default('json'),
})

export type GetRepoHandoverInput = z.infer<typeof getRepoHandoverSchema>
