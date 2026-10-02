import { z } from 'zod'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import {
  constitutionSeedJobKey,
  persistConstitutionSeed,
  prepareConstitutionSeed,
} from '@/lib/kairos/constitution/seed'
import { DRAFT_MAX_OUTPUT_TOKENS, parseConstitutionDraft, type GroundedDraft } from '@/lib/kairos/constitution/prompts'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { CONSTITUTION_SEED_WINDOW_UTC, isConstitutionSeedDay, isoWeekKey, minutesLeftInWindow } from '../deadlines'
import { errorReason } from './_errors'

// The first constitution draft on the thinking queue (docs/kairos/34 §2): one
// job per user per ISO week, planned on Mondays while no constitution is live
// and no amendment is pending, with exactly the system/user prompt the seed
// cron would send. apply parses strictly (no repair round-trip) and persists
// through the cron's own write path (first-draft-only, under the write lock).
// No paid key is needed on this path. Fallback = the Monday 05:58 UTC
// constitution-seed cron, which skips a user whose job is done.

export const CONSTITUTION_SEED_CRON = 'constitution-seed'

const contextSchema = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  reflectionIds: z.array(z.string()),
})
type ConstitutionSeedJobContext = z.infer<typeof contextSchema>

function readContext(job: ThinkingJobRow): ConstitutionSeedJobContext | null {
  const parsed = contextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (!isConstitutionSeedDay(now)) return []
  const deadlineMinutes = minutesLeftInWindow(now, CONSTITUTION_SEED_WINDOW_UTC)
  if (deadlineMinutes <= 0) return []

  const externalKey = constitutionSeedJobKey(now)
  if (await hasJobWithKeyLike(userId, 'constitution_seed', externalKey)) return []

  const prepared = await prepareConstitutionSeed(userId)
  if (prepared.status !== 'ready') return []

  return [{
    kind: 'constitution_seed',
    dominionId: null,
    externalKey,
    deadlineMinutes,
    input: {
      system: prepared.system,
      prompt: prepared.prompt,
      // Dominion ids are citable too (the prompt shows both); only reflection
      // ids become provenance links on the proposal.
      validMemoryIds: prepared.validIds,
      maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS,
      context: {
        week: isoWeekKey(now),
        reflectionIds: prepared.ctx.reflections.map((r) => r.id),
      } satisfies ConstitutionSeedJobContext,
    },
  }]
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const c = readContext(job)
  if (!c) return { ok: false, reason: 'bad_job: constitution_seed job has no week/reflection context' }
  if (c.week !== isoWeekKey(new Date())) return { ok: false, reason: `stale_job: planned for ${c.week}` }

  let draft: GroundedDraft
  try {
    draft = parseConstitutionDraft(text.trim(), job.input.validMemoryIds ?? [])
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }

  // The write lock re-checks "no constitution, no pending draft": a draft
  // that landed since planning (or a constitution accepted meanwhile) makes
  // this a complete no-op, exactly as the cron would skip.
  const result = await persistConstitutionSeed(job.userId, draft, c.reflectionIds)
  if (result.status === 'created') {
    await writeCronSuccessTrace(job.userId, { cronName: CONSTITUTION_SEED_CRON })
    return { ok: true, memoryIds: [result.proposalId], output: { principles: result.principles, answeredBy } }
  }
  return { ok: true, memoryIds: [], output: { skipped: result.reason, answeredBy } }
}

export const constitutionSeedHandler: ThinkingJobHandler = {
  kind: 'constitution_seed',
  plan,
  apply,
  // The Monday 05:58 UTC constitution-seed cron is the fallback; the sweep only expires.
  fallback: async () => ({ ok: false, reason: 'deferred to the Monday 05:58 UTC constitution-seed cron' }),
}
