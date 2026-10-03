import { z } from 'zod'
import { listHeldBeliefs, thinkingJobKeyExists, writeMindCompare, MIND_COMPARE_KIND } from '@/lib/data/beliefs'
import {
  COMPARE_SYSTEM_PROMPT,
  buildComparePrompt,
  pairBeliefsByCosine,
  parseCompareText,
  renderCompareMarkdown,
  type CompareBeliefRef,
  type GroundedCompare,
  type Pairing,
} from '@/lib/kairos/beliefs/compare'
import { askPaidAndParse } from '../paid-fallback'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { deadlineOn, isoWeekKey } from '../deadlines'
import { errorReason } from './_errors'
import { mindCompareThoughts, withThoughts } from '../stage-thoughts'

// Weekly mind comparison (docs/kairos/34 §1): Mondays from 04:00 UTC, held
// aligned vs own beliefs paired by embedding cosine; the model labels each
// pair agree/diverge and names notable one-sided beliefs. Writes ONE
// observation (sourceMetadata.kind 'mind_compare'). Fallback: paid heavy key.

export const MIND_COMPARE_EARLIEST_UTC = { hour: 4, minute: 0 }
export const MIND_COMPARE_DEADLINE_MINUTES = 3 * 60
export const MIND_COMPARE_MAX_OUTPUT_TOKENS = 4000
// One-sided beliefs shown to the model per mind (most recently touched first).
export const ONE_SIDED_IN_PROMPT_CAP = 40

export const mindCompareJobKey = (weekKey: string) => `${MIND_COMPARE_KIND}:${weekKey}`

const pairSchema = z.object({ alignedId: z.string().min(1), ownId: z.string().min(1), similarity: z.number() })
const contextSchema = z.object({
  weekKey: z.string().min(1),
  pairs: z.array(pairSchema),
  alignedOnly: z.array(z.string().min(1)),
  ownOnly: z.array(z.string().min(1)),
  beliefs: z.array(z.object({ id: z.string().min(1), domain: z.string(), claim: z.string() })),
})

export type MindCompareContext = z.infer<typeof contextSchema>

export async function planMindCompare(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (now.getUTCDay() !== 1) return []
  if (now.getTime() < deadlineOn(now, MIND_COMPARE_EARLIEST_UTC).getTime()) return []
  const weekKey = isoWeekKey(now)
  const externalKey = mindCompareJobKey(weekKey)
  if (await thinkingJobKeyExists(userId, externalKey)) return []

  const [aligned, own] = await Promise.all([listHeldBeliefs(userId, 'aligned'), listHeldBeliefs(userId, 'own')])
  if (aligned.length === 0 || own.length === 0) return []
  const full = pairBeliefsByCosine(aligned, own)
  const pairing: Pairing = {
    pairs: full.pairs,
    alignedOnly: full.alignedOnly.slice(0, ONE_SIDED_IN_PROMPT_CAP),
    ownOnly: full.ownOnly.slice(0, ONE_SIDED_IN_PROMPT_CAP),
  }
  const shown = new Set([...pairing.pairs.flatMap((p) => [p.alignedId, p.ownId]), ...pairing.alignedOnly, ...pairing.ownOnly])
  const beliefs = [...aligned, ...own]
    .filter((b) => shown.has(b.id))
    .map((b) => ({ id: b.id, domain: b.domain, claim: b.claim }))
  const context: MindCompareContext = { weekKey, ...pairing, beliefs }
  return [{
    kind: MIND_COMPARE_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes: MIND_COMPARE_DEADLINE_MINUTES,
    input: {
      system: COMPARE_SYSTEM_PROMPT,
      prompt: buildComparePrompt(weekKey, pairing, new Map(beliefs.map((b) => [b.id, b]))),
      validMemoryIds: [...shown],
      context,
      maxOutputTokens: MIND_COMPARE_MAX_OUTPUT_TOKENS,
    },
  }]
}

function readContext(job: ThinkingJobRow): MindCompareContext | null {
  const parsed = contextSchema.safeParse(job.input.context)
  return parsed.success ? parsed.data : null
}

async function persist(job: ThinkingJobRow, ctx: MindCompareContext, result: GroundedCompare, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const byId = new Map<string, CompareBeliefRef>(ctx.beliefs.map((b) => [b.id, b]))
  const agree = result.pairs.filter((p) => p.verdict === 'agree').length
  const linkIds = [...new Set([...result.pairs.flatMap((p) => [p.alignedId, p.ownId]), ...result.alignedOnly, ...result.ownOnly])]
  const { memoryId } = await writeMindCompare(job.userId, {
    externalKey: job.externalKey,
    title: `Mind compare · ${ctx.weekKey}`,
    bodyMd: renderCompareMarkdown(ctx.weekKey, result, byId),
    summary: `${agree} agree, ${result.pairs.length - agree} diverge, ${result.alignedOnly.length} aligned-only, ${result.ownOnly.length} own-only`,
    linkIds,
    sourceMetadata: {
      pairs: result.pairs,
      alignedOnly: result.alignedOnly,
      ownOnly: result.ownOnly,
      weekKey: ctx.weekKey,
      jobId: job.id,
      answeredBy,
    },
  })
  return withThoughts({ ok: true, memoryIds: [memoryId] }, mindCompareThoughts(result.pairs))
}

const pairingOf = (ctx: MindCompareContext): Pairing => ({ pairs: ctx.pairs, alignedOnly: ctx.alignedOnly, ownOnly: ctx.ownOnly })

export async function applyMindCompare(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid mind_compare context' }
  let result: GroundedCompare
  try {
    result = parseCompareText(text, pairingOf(ctx))
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  return persist(job, ctx, result, answeredBy)
}

export async function fallbackMindCompare(job: ThinkingJobRow): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid mind_compare context' }
  const res = await askPaidAndParse(job, {
    parse: (t) => parseCompareText(t, pairingOf(ctx)),
    label: MIND_COMPARE_KIND,
    maxTokens: job.input.maxOutputTokens ?? MIND_COMPARE_MAX_OUTPUT_TOKENS,
    repairContext: [
      'Valid pairs (alignedId | ownId) — label each, ids verbatim:',
      ...(ctx.pairs.length ? ctx.pairs.map((p) => `- ${p.alignedId} | ${p.ownId}`) : ['(none — return "pairs": [])']),
      'Valid alignedOnly ids:',
      ...ctx.alignedOnly.map((id) => `- ${id}`),
      'Valid ownOnly ids:',
      ...ctx.ownOnly.map((id) => `- ${id}`),
    ].join('\n'),
  })
  if (!res.ok) return res
  return persist(job, ctx, res.value, 'api')
}

export const mindCompareHandler: ThinkingJobHandler = {
  kind: MIND_COMPARE_KIND,
  plan: planMindCompare,
  apply: applyMindCompare,
  fallback: fallbackMindCompare,
}
