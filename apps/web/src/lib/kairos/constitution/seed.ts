import {
  findLiveConstitutionRow,
  insertConstitutionProposal,
  listPendingConstitutionProposals,
  listSeedDominions,
  listTopReflections,
} from '@/lib/data/constitution'
import { isJobDone } from '@/lib/data/thinking-jobs'
import { getProviderForUser } from '@/lib/ai/provider'
import { AiCredentialDecryptError, AiCredentialMissingError } from '@/lib/ai/router'
import { ParseRepairError, parseWithRepair, todayIso } from '@/lib/kairos/_prompt-utils'
import { isoWeekKey } from '@/lib/kairos/thinking/deadlines'
import { buildProposalValues } from './amendment'
import {
  CONSTITUTION_DRAFT_SYSTEM_PROMPT,
  DRAFT_MAX_OUTPUT_TOKENS,
  buildConstitutionDraftPrompt,
  draftValidIds,
  parseConstitutionDraft,
  type DraftContext,
  type GroundedDraft,
} from './prompts'

// First-draft seed (docs/kairos/34 §2): from Dominion vision/mission/objectives
// + the top 20 reflections, ask a heavy-tier model for a grounded, reasons-
// based draft and write it as a PROPOSAL (never the constitution). One-shot
// safe: nothing happens while a constitution exists or any amendment is
// pending — checked before the model call (no spend) and again under the
// write lock (no duplicate on a race).
//
// Two answerers share prepare + persist: the Monday `constitution_seed`
// thinking job (Claude Max routine, thinking/handlers/constitution-seed.ts)
// and the Monday 05:58 UTC cron (paid key), which skips a user whose job for
// this ISO week is already done.

export const SEED_REFLECTION_LIMIT = 20

export type SeedResult =
  | { status: 'created'; proposalId: string; principles: number }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; reason: string }

export type SeedSkipReason = 'constitution_exists' | 'pending_draft_exists' | 'no_signal'

export interface PreparedSeed {
  status: 'ready'
  ctx: DraftContext
  validIds: string[]
  system: string
  prompt: string
}

export function hasSeedSignal(ctx: DraftContext): boolean {
  return ctx.reflections.length > 0 ||
    ctx.dominions.some((d) => Boolean(d.vision?.trim() || d.missionLong?.trim() || d.objectives.length))
}

// One job per user per ISO week (the seed runs on Mondays).
export function constitutionSeedJobKey(now: Date): string {
  return `constitution_seed:${isoWeekKey(now)}`
}

// Cheap gates + the exact model input. No model call, no write.
export async function prepareConstitutionSeed(
  userId: string,
): Promise<PreparedSeed | { status: 'skipped'; reason: SeedSkipReason }> {
  if (await findLiveConstitutionRow(userId)) return { status: 'skipped', reason: 'constitution_exists' }
  if ((await listPendingConstitutionProposals(userId, 1)).length > 0) {
    return { status: 'skipped', reason: 'pending_draft_exists' }
  }

  const ctx: DraftContext = {
    dominions: await listSeedDominions(userId),
    reflections: await listTopReflections(userId, SEED_REFLECTION_LIMIT),
  }
  if (!hasSeedSignal(ctx)) return { status: 'skipped', reason: 'no_signal' }
  return {
    status: 'ready',
    ctx,
    validIds: draftValidIds(ctx),
    system: CONSTITUTION_DRAFT_SYSTEM_PROMPT,
    prompt: buildConstitutionDraftPrompt(ctx),
  }
}

// Shared write path: the first-draft proposal, under the write lock.
export async function persistConstitutionSeed(
  userId: string,
  draft: GroundedDraft,
  reflectionIds: readonly string[],
): Promise<SeedResult> {
  const reflections = new Set(reflectionIds)
  const values = buildProposalValues({
    principles: draft.principles,
    rationale: draft.rationale,
    basedOnVersion: 0,
    source: 'cron',
    // Only reflection ids are memories; Dominion ids stay in the prompt trail.
    citations: draft.citedIds.filter((id) => reflections.has(id)),
    runId: `constitution-seed:${todayIso()}`,
  })
  const res = await insertConstitutionProposal(userId, values, { firstDraftOnly: true })
  if (!res.written) return { status: 'skipped', reason: res.skipped }
  return { status: 'created', proposalId: res.memoryId, principles: draft.principles.length }
}

// Paid-key fallback (the cron).
export async function seedConstitutionDraft(userId: string, now: Date = new Date()): Promise<SeedResult> {
  if (await isJobDone(userId, constitutionSeedJobKey(now))) return { status: 'skipped', reason: 'already_ran' }

  const prepared = await prepareConstitutionSeed(userId)
  if (prepared.status === 'skipped') return prepared
  const { ctx, validIds } = prepared

  let provider: Awaited<ReturnType<typeof getProviderForUser>>
  let rawText: string
  try {
    provider = await getProviderForUser(userId, 'heavy')
    const res = await provider.ask({
      system: prepared.system,
      prompt: prepared.prompt,
      cacheSystem: true,
      maxTokens: DRAFT_MAX_OUTPUT_TOKENS,
    })
    rawText = res.text.trim()
  } catch (err) {
    if (err instanceof AiCredentialMissingError) return { status: 'skipped', reason: 'no BYOK credential' }
    if (err instanceof AiCredentialDecryptError) return { status: 'skipped', reason: 'key undecryptable' }
    throw err
  }
  if (!rawText) return { status: 'error', reason: 'empty model response' }

  let draft: GroundedDraft
  try {
    draft = await parseWithRepair({
      provider,
      rawText,
      parse: (t) => parseConstitutionDraft(t, validIds),
      generatorLabel: 'constitution draft',
      maxTokens: DRAFT_MAX_OUTPUT_TOKENS,
      system: CONSTITUTION_DRAFT_SYSTEM_PROMPT,
      repairContext: ['Valid ids — every citation MUST be one of these, copied in full:', ...validIds.map((id) => `- ${id}`)].join('\n'),
    })
  } catch (err) {
    if (err instanceof ParseRepairError) return { status: 'error', reason: err.message }
    throw err
  }

  return persistConstitutionSeed(userId, draft, ctx.reflections.map((r) => r.id))
}
