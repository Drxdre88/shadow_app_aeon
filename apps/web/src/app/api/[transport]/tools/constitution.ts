import { z } from 'zod'
import {
  amendmentPrincipleSchema,
  getConstitutionSchema,
  proposeConstitutionAmendmentSchema,
} from '@/lib/data/validators/constitution'
import { getConstitutionOverview, proposeConstitutionAmendment } from '@/lib/kairos/constitution/amendment'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos constitution (docs/kairos/34 §2) — read the operator's live,
// reasons-based constitution and PROPOSE amendments. Nothing here writes the
// constitution: a proposal changes it only when the operator accepts it.
// Shares validators + fns with /api/v1/kairos/constitution (locked by
// constitution-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerConstitutionTools: RegisterFn = (server) => {
  server.tool(
    'get_constitution',
    'Read the operator\'s live Kairos constitution: numbered principles, each with its reason, plus the version history, pending amendment proposals and the latest nightly drift reading (mean similarity to the baseline, alert, flipped probes). Returns constitution:null before the first draft is accepted.',
    {},
    { title: 'Get Constitution', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getConstitutionSchema.safeParse(args ?? {})
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      return ok(await getConstitutionOverview(uid))
    }
  )

  server.tool(
    'propose_constitution_amendment',
    'Propose an amendment to the Kairos constitution. Send the COMPLETE amended list of principles (each with the reason it holds) — accepting replaces the live constitution with exactly these, renumbered in order. Writes a pending proposal for the operator to accept or dismiss; it never changes the constitution itself.',
    {
      principles: z.array(amendmentPrincipleSchema).min(1).max(30)
        .describe('The full amended principle list, in order: [{ text, reason }]'),
      rationale: z.string().min(1).max(2000).describe('Why this amendment — what changed or what it fixes'),
    },
    { title: 'Propose Constitution Amendment', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = proposeConstitutionAmendmentSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      return ok(await proposeConstitutionAmendment(uid, parsed.data, 'claude'))
    }
  )
}
