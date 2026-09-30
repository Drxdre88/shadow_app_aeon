import { z } from 'zod'

// Thinking queue validators (docs/kairos/32 §3) — shared by the MCP tools
// (app/api/[transport]/tools/thinking.ts) and the REST routes under
// /api/v1/kairos/thinking-jobs so both surfaces accept the same shapes.

export const thinkingJobKindSchema = z.enum(['aether', 'cortex', 'concept'])
export const thinkingJobStatusSchema = z.enum(['queued', 'claimed', 'done', 'failed', 'expired', 'fallback'])

export const claimThinkingJobSchema = z.object({
  kinds: z.array(thinkingJobKindSchema).min(1).max(3).optional(),
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
