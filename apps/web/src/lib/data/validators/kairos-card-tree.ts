import { z } from 'zod'
import { CARD_TREE_GOAL_MAX } from '@/lib/kairos/card-tree/types'

// Shared by request_card_tree (MCP), POST /api/v1/kairos/card-tree and the
// requestCardTreeAction server action (kairos-card-tree-parity.test.ts).
export const requestCardTreeSchema = z.object({
  projectId: z.string().uuid('projectId must be a board id'),
  goal: z.string().trim().min(3, 'Describe the goal in a few words').max(CARD_TREE_GOAL_MAX, `Keep the goal under ${CARD_TREE_GOAL_MAX} characters`),
})
export type RequestCardTreeInput = z.infer<typeof requestCardTreeSchema>
