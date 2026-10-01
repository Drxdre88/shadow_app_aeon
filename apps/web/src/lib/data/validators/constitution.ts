import { z } from 'zod'
import {
  MAX_PRINCIPLES,
  PRINCIPLE_REASON_MAX,
  PRINCIPLE_TEXT_MAX,
  RATIONALE_MAX,
} from '@/lib/kairos/constitution/schema'

// Constitution validators (docs/kairos/34 §2) — shared verbatim by the
// get_constitution / propose_constitution_amendment MCP tools and the
// /api/v1/kairos/constitution REST routes (locked by constitution-parity.test.ts).

export const getConstitutionSchema = z.object({})

export const amendmentPrincipleSchema = z.object({
  text: z.string().trim().min(1).max(PRINCIPLE_TEXT_MAX),
  reason: z.string().trim().min(1).max(PRINCIPLE_REASON_MAX),
})

// The COMPLETE amended principle list (numbered server-side) — accepting the
// proposal replaces the live constitution with exactly these principles.
export const proposeConstitutionAmendmentSchema = z.object({
  principles: z.array(amendmentPrincipleSchema).min(1).max(MAX_PRINCIPLES),
  rationale: z.string().trim().min(1).max(RATIONALE_MAX),
})

export type GetConstitutionInput = z.infer<typeof getConstitutionSchema>
export type ProposeConstitutionAmendmentInput = z.infer<typeof proposeConstitutionAmendmentSchema>
