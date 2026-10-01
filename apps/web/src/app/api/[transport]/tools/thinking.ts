import { z } from 'zod'
import {
  claimThinkingJobSchema,
  listThinkingJobsSchema,
  submitThinkingJobSchema,
  thinkingJobKindSchema,
  thinkingJobStatusSchema,
} from '@/lib/data/validators/thinking'
import {
  claimThinkingJob,
  listThinkingJobs,
  submitThinkingJob,
} from '@/lib/kairos/thinking/queue'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos thinking queue (docs/kairos/32 §3, playbook docs/kairos/33) — the
// Claude Max routine path. Claude comes to the brain: it claims a job (the
// exact system + user prompt the paid-key cron would send), thinks, and
// submits raw text; the server validates, grounds, mints ids and persists.
// Mirrors REST /api/v1/kairos/thinking-jobs (same validators + functions).
// ─────────────────────────────────────────────────────────────────────────

export const registerThinkingTools: RegisterFn = (server) => {
  server.tool(
    'claim_thinking_job',
    'Claim the next queued Kairos thinking job. Kinds: cortex, aether, concept, belief_extract, drift_probe, mind_compare, weekly_review, idea_generate, idea_judge, daily_message, chat. Due jobs are planned on claim, in prerequisite order (submitting idea_generate plans idea_judge, so claim again to judge the same night). Without `kinds`, any kind except chat is returned; chat jobs are claimed only with kinds ["chat"]. Returns { job: { id, kind, claimToken, deadlineAt, system, prompt, validMemoryIds, instructions } } or { job: null } when nothing is due. Follow `system` + `prompt` exactly and answer as `instructions` say — the JSON only for every kind except chat, which is answered in plain text — then call submit_thinking_job. Never write memories for a job yourself.',
    {
      kinds: z.array(thinkingJobKindSchema).min(1).max(11).optional().describe('Only claim these kinds (default: any)'),
    },
    { title: 'Claim Thinking Job', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = claimThinkingJobSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      return ok(await claimThinkingJob(uid, parsed.data))
    },
  )

  server.tool(
    'submit_thinking_job',
    'Submit your raw answer (the JSON the job\'s system prompt asked for) for a claimed thinking job. The server parses it strictly (no repair), grounds citations against validMemoryIds, mints ids and persists it. Returns { ok, memoryIds } or an error explaining why the answer was rejected; a rejected or late job is closed and its fallback covers it (cortex/aether: the nightly cron; concept: the hourly sweep\'s API fallback) — never retry it.',
    {
      jobId: z.string().uuid().describe('job.id from claim_thinking_job'),
      claimToken: z.string().uuid().describe('job.claimToken from claim_thinking_job'),
      text: z.string().min(1).max(200_000).describe('Your raw answer text — the JSON object only'),
    },
    { title: 'Submit Thinking Job', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = submitThinkingJobSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const result = await submitThinkingJob(uid, parsed.data)
      if (!result.ok) return fail(`submit_thinking_job ${result.code}: ${result.error}`)
      return ok(result)
    },
  )

  server.tool(
    'list_thinking_jobs',
    'List recent Kairos thinking jobs (newest first) with status, deadline, attempts, error and output (memory ids) — no prompts. Use to check what the queue holds or what a routine run did.',
    {
      status: thinkingJobStatusSchema.optional().describe('Filter by status'),
      limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 20)'),
    },
    { title: 'List Thinking Jobs', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = listThinkingJobsSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      return ok(await listThinkingJobs(uid, parsed.data))
    },
  )
}
