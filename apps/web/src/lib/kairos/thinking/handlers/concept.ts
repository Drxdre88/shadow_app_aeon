import { createHash } from 'node:crypto'
import { z } from 'zod'
import { findDominionsByUser } from '@/lib/data/dominions'
import { dropDormantWhenOn } from '@/lib/kairos/living/focus-gate'
import {
  createConceptWithOp,
  listConceptCandidates,
  listConceptHistory,
  updateConceptWithOp,
  type ConceptCandidateRow,
  type ConceptWriteValues,
} from '@/lib/data/concepts'
import { getProviderForUser } from '@/lib/ai/provider'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'
import { parseWithRepair, ParseRepairError } from '@/lib/kairos/_prompt-utils'
import { clusterByCosine, matchExistingConcept } from '@/lib/kairos/concepts/cluster'
import {
  CONCEPT_SYSTEM_PROMPT,
  buildConceptPrompt,
  conceptSummary,
  parseConceptText,
  renderConceptMarkdown,
  type GroundedConcept,
} from '@/lib/kairos/concepts/concept-prompt'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { isConceptDay, isoWeekKey } from '../deadlines'

// Concept tier thinking-job handler (docs/kairos/26 §4, docs/kairos/32 §2.4 + §3).
// plan: Sundays (UTC) only — per active Dominion, cluster live members and emit
// one job per cluster that is new or whose membership changed. apply: strict
// parse + grounding, then create the concept or update the matched one in place.
// Clusters dominated by operator reflections become PROPOSALS (spec 26 autonomy).

export const CONCEPT_STEP = 'concepts'
export const CONCEPT_JOB_DEADLINE_MINUTES = 6 * 60
export const MAX_CONCEPTS_PER_WEEK = 8
export const CONCEPT_MAX_OUTPUT_TOKENS = 2000
const OPERATOR_DOMINANCE = 0.5

// Pure week helpers live in ../deadlines (the queue needs them without the
// handler's DB imports); re-exported for existing callers.
export { isConceptDay, isoWeekKey }

export function memberSetHash(memberIds: readonly string[]): string {
  return createHash('sha256').update([...memberIds].sort().join(',')).digest('hex').slice(0, 12)
}

const jobContextSchema = z.object({
  dominionId: z.string().min(1),
  weekKey: z.string().min(1),
  memberIds: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1),
  proposal: z.boolean(),
  matchId: z.string().nullable(),
  overlap: z.number().nullable(),
})

export type ConceptJobContext = z.infer<typeof jobContextSchema>

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

function memberConfidence(m: ConceptCandidateRow): number {
  return m.confidence ?? confidenceForStreamClass(m.streamClass)
}

interface RankedSpec {
  spec: ThinkingJobSpec
  size: number
  score: number
}

async function planDominion(
  userId: string,
  dominion: { id: string; name: string },
  weekKey: string,
): Promise<RankedSpec[]> {
  const candidates = await listConceptCandidates(userId, dominion.id)
  const clusters = clusterByCosine(candidates.map((c) => ({ id: c.id, embedding: c.embedding })))
  if (clusters.length === 0) return []
  // Every concept-tier row ever written for this Dominion, whatever its state:
  // live rows are update targets; resolved ones (dismissed, accepted, promoted,
  // superseded, archived) block re-proposing the same cluster.
  const history = await listConceptHistory(userId, dominion.id)
  const live = history.filter((e) => e.state === 'live')
  const resolved = history.filter((e) => e.state === 'resolved')
  const byId = new Map(candidates.map((c) => [c.id, c]))

  const out: RankedSpec[] = []
  for (const memberIds of clusters) {
    const members = memberIds.map((id) => byId.get(id)).filter((m): m is ConceptCandidateRow => Boolean(m))
    if (members.length === 0) continue
    const reflections = members.filter((m) => m.streamClass === 'reflection').length
    const proposal = reflections / members.length > OPERATOR_DOMINANCE
    const sameKind = live.filter((e) => e.isProposal === proposal)
    const match = matchExistingConcept(memberIds, sameKind)
    if (match) {
      const target = sameKind.find((e) => e.id === match.id)
      // Unchanged membership → nothing to re-distil; pinned → operator-locked.
      if (match.overlap === 1 || target?.pinned) continue
    } else if (matchExistingConcept(memberIds, resolved)) {
      // The operator already answered this cluster (a dismissal is a veto; an
      // accept made it theirs) — never re-propose it week after week.
      continue
    }
    const confidence = clamp01(members.reduce((s, m) => s + memberConfidence(m), 0) / members.length)
    const score = members.reduce((s, m) => s + (m.standing ?? memberConfidence(m)), 0) / members.length
    const context: ConceptJobContext = {
      dominionId: dominion.id,
      weekKey,
      memberIds,
      confidence,
      proposal,
      matchId: match?.id ?? null,
      overlap: match?.overlap ?? null,
    }
    out.push({
      size: members.length,
      score,
      spec: {
        kind: 'concept',
        dominionId: dominion.id,
        externalKey: `concept:${dominion.id}:${weekKey}:${memberSetHash(memberIds)}`,
        deadlineMinutes: CONCEPT_JOB_DEADLINE_MINUTES,
        input: {
          system: CONCEPT_SYSTEM_PROMPT,
          prompt: buildConceptPrompt({ dominionName: dominion.name, members }),
          validMemoryIds: memberIds,
          context,
          maxOutputTokens: CONCEPT_MAX_OUTPUT_TOKENS,
        },
      },
    })
  }
  return out
}

export async function planConcepts(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (!isConceptDay(now)) return []
  const weekKey = isoWeekKey(now)
  const dominions = await dropDormantWhenOn((await findDominionsByUser(userId)).filter((d) => !d.archivedAt))
  const ranked: RankedSpec[] = []
  for (const dom of dominions) ranked.push(...(await planDominion(userId, dom, weekKey)))
  ranked.sort((a, b) =>
    b.size - a.size || b.score - a.score || (a.spec.externalKey < b.spec.externalKey ? -1 : 1))
  return ranked.slice(0, MAX_CONCEPTS_PER_WEEK).map((r) => r.spec)
}

function readContext(job: ThinkingJobRow): ConceptJobContext | null {
  const parsed = jobContextSchema.safeParse(job.input.context)
  return parsed.success ? parsed.data : null
}

async function persistConcept(
  job: ThinkingJobRow,
  ctx: ConceptJobContext,
  concept: GroundedConcept,
  answeredBy: ThinkingAnsweredBy,
): Promise<ApplyOutcome> {
  const links = ctx.memberIds.map((target) => ({ type: 'refers_to', target, target_kind: 'memory' }))
  const baseMeta = {
    kind: 'concept',
    memberIds: ctx.memberIds,
    citedIds: concept.citedIds,
    weekKey: ctx.weekKey,
    jobId: job.id,
    answeredBy,
  }
  const values: ConceptWriteValues = ctx.proposal
    ? {
        dominionId: ctx.dominionId,
        externalKey: job.externalKey,
        title: concept.title,
        bodyMd: renderConceptMarkdown(concept),
        summary: conceptSummary(concept),
        type: 'inbound',
        streamClass: 'agentic',
        confidence: confidenceForStreamClass('agentic'),
        links,
        tags: ['proposal', 'concept'],
        // introspection:true makes it a first-class proposal: the inbox lists it,
        // acceptProposal accepts it, and BackUp can promote it on support.
        sourceMetadata: { ...baseMeta, introspection: true, status: 'pending' },
      }
    : {
        dominionId: ctx.dominionId,
        externalKey: job.externalKey,
        title: concept.title,
        bodyMd: renderConceptMarkdown(concept),
        summary: conceptSummary(concept),
        type: 'concept',
        streamClass: 'concept',
        confidence: ctx.confidence,
        links,
        tags: ['concept'],
        sourceMetadata: baseMeta,
      }
  const what = ctx.proposal ? 'concept proposal' : 'concept'
  const reason = `${what} "${concept.title}" from ${ctx.memberIds.length} members (${concept.citedIds.length} cited) via ${answeredBy}`

  if (ctx.matchId) {
    const updated = await updateConceptWithOp(job.userId, job.id, ctx.matchId, values, {
      step: CONCEPT_STEP,
      reason: `${reason}; overlap ${(ctx.overlap ?? 0).toFixed(2)} with ${ctx.matchId}`,
    })
    if (updated) return { ok: true, memoryIds: [updated.memoryId] }
    // Target vanished/was pinned since planning → fall through to a fresh row.
  }
  const created = await createConceptWithOp(job.userId, job.id, values, { step: CONCEPT_STEP, reason })
  return { ok: true, memoryIds: [created.memoryId] }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function applyConcept(
  job: ThinkingJobRow,
  text: string,
  answeredBy: ThinkingAnsweredBy,
): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'invalid concept job context' }
  let concept: GroundedConcept
  try {
    concept = parseConceptText(text, ctx.memberIds)
  } catch (err) {
    return { ok: false, reason: `concept rejected: ${errMessage(err)}` }
  }
  return persistConcept(job, ctx, concept, answeredBy)
}

export async function fallbackConcept(job: ThinkingJobRow): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'invalid concept job context' }
  const maxTokens = job.input.maxOutputTokens ?? CONCEPT_MAX_OUTPUT_TOKENS

  let provider: Awaited<ReturnType<typeof getProviderForUser>>
  let rawText: string
  try {
    provider = await getProviderForUser(job.userId, 'heavy')
    const res = await provider.ask({ system: job.input.system, prompt: job.input.prompt, cacheSystem: true, maxTokens })
    rawText = res.text.trim()
  } catch (err) {
    if (err instanceof AiCredentialMissingError) return { ok: false, reason: 'no BYOK credential' }
    if (err instanceof AiCredentialDecryptError) return { ok: false, reason: 'key undecryptable' }
    throw err
  }
  if (!rawText) return { ok: false, reason: 'empty model response' }

  let concept: GroundedConcept
  try {
    concept = await parseWithRepair({
      provider,
      rawText,
      parse: (t) => parseConceptText(t, ctx.memberIds),
      generatorLabel: 'concept',
      maxTokens,
      system: job.input.system,
      repairContext: [
        'Valid member ids — cite these verbatim in [brackets], at least three different ones:',
        ...ctx.memberIds.map((id) => `- ${id}`),
      ].join('\n'),
    })
  } catch (err) {
    if (err instanceof ParseRepairError) return { ok: false, reason: `concept rejected: ${err.message}` }
    throw err
  }
  return persistConcept(job, ctx, concept, 'api')
}

export const conceptHandler: ThinkingJobHandler = {
  kind: 'concept',
  plan: planConcepts,
  apply: applyConcept,
  fallback: fallbackConcept,
}
