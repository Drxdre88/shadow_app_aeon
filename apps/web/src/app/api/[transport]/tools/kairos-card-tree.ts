import { requestCardTree } from '@/lib/data/card-tree'
import { requestCardTreeSchema } from '@/lib/data/validators/kairos-card-tree'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// Goal → card tree (Workforce). Queues a draft only: Vorath proposes the
// cards later and the owner approves before any card exists. Same editor
// check as the board. Mirrors POST /api/v1/kairos/card-tree
// (kairos-card-tree-parity.test.ts).

export const registerKairosCardTreeTools: RegisterFn = (server) => {
  server.tool(
    'request_card_tree',
    'Ask Vorath to plan a goal as a small tree of cards (at most 12, with dependencies, checklists and only the board\'s existing labels) on one board you can edit. This only queues the request: Vorath drafts the tree on his next run and it waits in the owner\'s inbox (and Telegram) for Approve or Veto — no card is created until the owner approves. Returns the job id. The same goal on the same board returns the existing request. Refused while the caller\'s own Vorath thinking routine is not connected (it has not claimed a job in the last 26 hours), since nothing else would draft the plan.',
    {
      projectId: requestCardTreeSchema.shape.projectId.describe('The board (project) id'),
      goal: requestCardTreeSchema.shape.goal.describe('The goal in plain words, up to 1000 characters'),
    },
    { title: 'Request Vorath Card Tree', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = requestCardTreeSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const res = await requestCardTree(uid, parsed.data)
      if (!res.ok) return fail(res.message)
      return ok(res)
    }
  )
}
