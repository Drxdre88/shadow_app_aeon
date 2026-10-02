import { z } from 'zod'

// Thinking queue validators (docs/kairos/32 §3) — shared by the MCP tools
// (app/api/[transport]/tools/thinking.ts) and the REST routes under
// /api/v1/kairos/thinking-jobs so both surfaces accept the same shapes.

// Every kind a routine may claim (the planned kinds plus chat). Retired kinds
// (brief, introspection, contradiction, micro_consolidate — Kairos 0.17) are
// not claimable; their historical rows still list (listing never validates kind).
export const thinkingJobKindSchema = z.enum([
  'aether', 'cortex', 'concept',
  'belief_extract', 'drift_probe', 'mind_compare', 'weekly_review', 'daily_message', 'chat',
  'idea_generate', 'idea_judge',
  'chat_distill', 'archetype', 'ask_mine',
])
export const thinkingJobStatusSchema = z.enum(['queued', 'claimed', 'done', 'failed', 'expired', 'fallback'])

export const RETIRED_THINKING_KINDS = ['brief', 'introspection', 'contradiction', 'micro_consolidate'] as const

// A routine set up before 0.17 may still name retired kinds: drop them so its
// claim keeps working for the rest. Nothing left → the claim returns job: null.
const claimKindsSchema = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((k) => !(RETIRED_THINKING_KINDS as readonly unknown[]).includes(k)) : v),
  z.array(thinkingJobKindSchema).max(thinkingJobKindSchema.options.length),
)

export const claimThinkingJobSchema = z.object({
  kinds: claimKindsSchema.optional(),
})

export const submitThinkingJobSchema = z.object({
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
  text: z.string().min(1).max(200_000),
})

export const listThinkingJobsSchema = z.object({
  status: thinkingJobStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type ClaimThinkingJobInput = z.infer<typeof claimThinkingJobSchema>
export type SubmitThinkingJobInput = z.infer<typeof submitThinkingJobSchema>
export type ListThinkingJobsInput = z.infer<typeof listThinkingJobsSchema>
