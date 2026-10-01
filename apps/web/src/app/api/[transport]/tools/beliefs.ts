import { z } from 'zod'
import { getMindComparisonSchema, listBeliefsSchema } from '@/lib/data/validators/beliefs'
import { getLatestMindCompare, listBeliefs } from '@/lib/data/beliefs'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Belief ledger (docs/kairos/34 §1) — the aligned mind (operator's beliefs)
// and Kairos's own mind, plus the latest weekly comparison. Read-only. Shares
// validators + data fns with /api/v1/kairos/beliefs (beliefs-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerBeliefTools: RegisterFn = (server) => {
  server.tool(
    'list_beliefs',
    'List Kairos belief-ledger entries: the ALIGNED mind (claims extracted from the operator\'s own words) and Kairos\'s OWN mind (beliefs it formed from engine promotions). Each has a claim, domain, reasons, falsifier, provenance memory ids, status and confidence. Defaults to held beliefs, newest first.',
    {
      mind: z.enum(['aligned', 'own']).optional().describe('Only this mind'),
      domain: z.string().optional().describe('Only this domain (Dominion name or "general")'),
      status: z.enum(['held', 'retired', 'all']).optional().describe('held (default), retired (superseded/vetoed) or all'),
      limit: z.number().int().min(1).max(200).optional().describe('Max beliefs (default 50)'),
    },
    { title: 'List Beliefs', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = listBeliefsSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const beliefs = await listBeliefs(uid, parsed.data)
      return ok({ count: beliefs.length, beliefs })
    }
  )

  server.tool(
    'get_mind_comparison',
    'Get the latest weekly comparison of the aligned mind vs Kairos\'s own mind: same-topic belief pairs labelled agree/diverge with a note, plus notable aligned-only and own-only beliefs. Returns null comparison when none has run yet.',
    {},
    { title: 'Get Mind Comparison', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getMindComparisonSchema.safeParse(args ?? {})
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      return ok({ comparison: await getLatestMindCompare(uid) })
    }
  )
}
