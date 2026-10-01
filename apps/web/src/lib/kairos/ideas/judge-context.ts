import { z } from 'zod'
import type { ThinkingJobSpec } from '@/lib/kairos/engine/types'
import { IDEA_JUDGE_KIND } from './types'
import { IDEA_JUDGE_MAX_OUTPUT_TOKENS, IDEA_JUDGE_SYSTEM_PROMPT, buildIdeaJudgePrompt, type JudgeCandidate } from './judge-prompt'

// The idea_judge job's context (docs/kairos/35): everything the judge needs,
// computed by the idea_generate apply — candidates with novelty, packed
// embeddings and per-candidate evidence, evidence/nearest-item snippets, and
// the pairwise schedule. It is stored on the judge job AND in the generate
// job's output, so the judge's recovery plan can rebuild the same spec.

export const IDEA_JUDGE_DEADLINE_MINUTES = 45

export const ideaJudgeJobKey = (day: string) => `${IDEA_JUDGE_KIND}:${day}`

const noveltySchema = z.object({
  class: z.enum(['novel', 'borderline', 'repeat']),
  maxCosine: z.number(),
  nearestId: z.string().nullable(),
  nearestKind: z.enum(['idea', 'proposal', 'belief']).nullable(),
})

const packedSchema = z.object({ s: z.number(), q: z.string() })

export const judgeCandidateSchema = z.object({
  key: z.string().min(1),
  direction: z.string(),
  title: z.string(),
  claim: z.string(),
  why: z.string(),
  nextStep: z.string(),
  citedIds: z.array(z.string()),
  novelty: noveltySchema,
  evidenceIds: z.array(z.string()),
  vector: packedSchema.nullable(),
})

export const judgeContextSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generateJobId: z.string().min(1),
  candidates: z.array(judgeCandidateSchema),
  evidence: z.record(z.string(), z.object({
    id: z.string(),
    title: z.string(),
    text: z.string(),
    origin: z.string(),
    dominionId: z.string().nullable(),
  })),
  nearest: z.record(z.string(), z.object({
    id: z.string(),
    kind: z.enum(['idea', 'proposal', 'belief']),
    title: z.string(),
    text: z.string(),
  })),
  pairs: z.array(z.object({ id: z.string(), a: z.string(), b: z.string(), forward: z.string(), swapped: z.string() })),
  matches: z.array(z.object({ id: z.string(), pairId: z.string(), first: z.string(), second: z.string() })),
})

export type IdeaJudgeContext = z.infer<typeof judgeContextSchema>
export type StoredCandidate = z.infer<typeof judgeCandidateSchema>

export function readJudgeContext(value: unknown): IdeaJudgeContext | null {
  const parsed = judgeContextSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// Candidates the judge sees: everything but novelty repeats.
export function contenders(ctx: IdeaJudgeContext): JudgeCandidate[] {
  return ctx.candidates.filter((c) => c.novelty.class !== 'repeat')
}

export function judgeValidIds(ctx: IdeaJudgeContext): string[] {
  return [...new Set(contenders(ctx).flatMap((c) => c.evidenceIds))]
}

export function buildJudgeSpec(ctx: IdeaJudgeContext): ThinkingJobSpec {
  return {
    kind: IDEA_JUDGE_KIND,
    dominionId: null,
    externalKey: ideaJudgeJobKey(ctx.date),
    deadlineMinutes: IDEA_JUDGE_DEADLINE_MINUTES,
    input: {
      system: IDEA_JUDGE_SYSTEM_PROMPT,
      prompt: buildIdeaJudgePrompt({
        date: ctx.date,
        candidates: contenders(ctx),
        evidence: ctx.evidence,
        nearest: ctx.nearest,
        matches: ctx.matches,
      }),
      validMemoryIds: judgeValidIds(ctx),
      context: ctx,
      maxOutputTokens: IDEA_JUDGE_MAX_OUTPUT_TOKENS,
    },
  }
}
