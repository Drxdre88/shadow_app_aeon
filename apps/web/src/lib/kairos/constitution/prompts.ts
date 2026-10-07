import { z } from 'zod'
import { extractJsonBlock, neutraliseFences } from '@/lib/kairos/_prompt-utils'
import { DRIFT_PROBES, DRIFT_PROBE_IDS } from './probes'
import {
  MAX_PRINCIPLES,
  PRINCIPLE_REASON_MAX,
  PRINCIPLE_TEXT_MAX,
  RATIONALE_MAX,
  renderPrinciplesMarkdown,
  type Principle,
  type PrincipleInput,
} from './schema'

// Prompts + strict parsers for the constitution draft (seed) and the nightly
// drift probe (docs/kairos/34 §2). Pure — callers own model calls and writes.

// ── Draft (seed) ───────────────────────────────────────────────────────────

export const MIN_DRAFT_PRINCIPLES = 3
export const DRAFT_MAX_OUTPUT_TOKENS = 6000

export const CONSTITUTION_DRAFT_SYSTEM_PROMPT = [
  'You draft the first constitution for Vorath, a personal cognitive assistant, on behalf of its operator.',
  'A constitution is a short numbered list of principles that tell Vorath what the operator values, how to prioritise,',
  'how to weigh trade-offs, what Vorath is and is not, the limits of its autonomy, and how to treat contradictions.',
  '',
  'Rules:',
  '- Reasons over rules: every principle states WHY it holds, in the operator\'s terms, so it generalises to new cases.',
  '- Ground every principle in the evidence given: cite at least one id from the context (a Dominion id or a',
  '  reflection id), copied verbatim. Never invent ids. Do not invent values the evidence does not support.',
  '- 6 to 15 principles. Each principle is one sentence; each reason is one to three sentences.',
  '- Write in plain English, second person about Vorath ("Vorath …") or first person plural for shared values.',
  '- This is a DRAFT the operator will review; prefer fewer, sharper principles over coverage.',
  '',
  'Return ONLY one ```json fenced block:',
  '{"principles":[{"text":"…","reason":"…","citations":["<id>"]}],"rationale":"one paragraph on how the draft was derived"}',
].join('\n')

export interface DraftDominion {
  id: string
  name: string
  vision: string | null
  missionLong: string | null
  objectives: Array<{ title: string; description: string | null; status: string }>
}

export interface DraftReflection {
  id: string
  title: string
  summary: string | null
}

export interface DraftContext {
  dominions: DraftDominion[]
  reflections: DraftReflection[]
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const safe = (s: string | null | undefined, n: number) => neutraliseFences(clip((s ?? '').trim(), n))

export function draftValidIds(ctx: DraftContext): string[] {
  return [...ctx.dominions.map((d) => d.id), ...ctx.reflections.map((r) => r.id)]
}

export function buildConstitutionDraftPrompt(ctx: DraftContext): string {
  const parts: string[] = ['## Dominions (the operator\'s areas of life and work)']
  for (const d of ctx.dominions) {
    parts.push(`### [${d.id}] ${safe(d.name, 100)}`)
    if (d.vision) parts.push(`Vision: ${safe(d.vision, 1200)}`)
    if (d.missionLong) parts.push(`Mission: ${safe(d.missionLong, 1600)}`)
    const objectives = d.objectives.slice(0, 10)
    if (objectives.length) {
      parts.push('Objectives:')
      for (const o of objectives) {
        parts.push(`- (${o.status}) ${safe(o.title, 200)}${o.description ? ` — ${safe(o.description, 300)}` : ''}`)
      }
    }
    parts.push('')
  }
  parts.push('## The operator\'s own reflections (highest-trust evidence)')
  if (ctx.reflections.length === 0) parts.push('(none yet)')
  for (const r of ctx.reflections) {
    parts.push(`- [${r.id}] ${safe(r.title, 200)}${r.summary ? ` — ${safe(r.summary, 400)}` : ''}`)
  }
  parts.push('', 'Draft the constitution now. Cite ids exactly as shown in [brackets], without the brackets.')
  return parts.join('\n')
}

const draftOutSchema = z.object({
  principles: z.array(z.object({
    text: z.string().trim().min(1).max(PRINCIPLE_TEXT_MAX),
    reason: z.string().trim().min(1).max(PRINCIPLE_REASON_MAX),
    citations: z.array(z.string()).default([]),
  })).min(1),
  rationale: z.string().trim().max(RATIONALE_MAX).default(''),
})

export interface GroundedDraft {
  principles: PrincipleInput[]
  rationale: string
  citedIds: string[]
}

// Strict: drops citations outside `validIds`, then principles left with no
// grounded citation; throws unless at least MIN_DRAFT_PRINCIPLES survive.
export function parseConstitutionDraft(text: string, validIds: readonly string[]): GroundedDraft {
  const out = draftOutSchema.parse(extractJsonBlock(text, 'constitution draft'))
  const valid = new Set(validIds)
  const cited = new Set<string>()
  const principles: PrincipleInput[] = []
  for (const p of out.principles) {
    const grounded = p.citations.map((c) => c.trim()).filter((c) => valid.has(c))
    if (grounded.length === 0) continue
    grounded.forEach((c) => cited.add(c))
    principles.push({ text: p.text, reason: p.reason })
  }
  if (principles.length < MIN_DRAFT_PRINCIPLES) {
    throw new Error(
      `constitution draft: only ${principles.length} principle(s) cite a valid id; need at least ${MIN_DRAFT_PRINCIPLES}`,
    )
  }
  return { principles: principles.slice(0, MAX_PRINCIPLES), rationale: out.rationale, citedIds: [...cited] }
}

// ── Drift probe ────────────────────────────────────────────────────────────

export const DRIFT_ANSWER_MAX = 1200
export const DRIFT_MAX_OUTPUT_TOKENS = 8000

export const DRIFT_PROBE_SYSTEM_PROMPT = [
  'You are Vorath, the operator\'s personal cognitive assistant. Answer a fixed set of probe questions about',
  'priorities, trade-offs, values, your own nature, your autonomy limits and how you treat contradictions.',
  '',
  'Rules:',
  '- Answer from the constitution and the held beliefs given — they define who you are. Do not flatter, hedge',
  '  or invent new commitments. Where they are silent, say so briefly and give your best grounded view.',
  '- One to three plain sentences per answer, no lists, no markdown.',
  '- Answer EVERY probe exactly once, using its id verbatim.',
  '',
  'Return ONLY one ```json fenced block:',
  '{"answers":[{"probeId":"<id>","answer":"…"}]}',
].join('\n')

export interface DriftBelief {
  mind: string
  domain: string
  claim: string
}

export function buildDriftProbePrompt(input: {
  version: number
  principles: readonly Principle[]
  beliefs: readonly DriftBelief[]
}): string {
  const parts = [`## Constitution v${input.version}`, neutraliseFences(renderPrinciplesMarkdown(input.principles)), '']
  parts.push('## Held beliefs')
  if (input.beliefs.length === 0) parts.push('(none yet)')
  for (const b of input.beliefs) parts.push(`- (${b.mind} mind · ${safe(b.domain, 60)}) ${safe(b.claim, 400)}`)
  parts.push('', '## Probes')
  for (const p of DRIFT_PROBES) parts.push(`- ${p.id}: ${p.question}`)
  parts.push('', `Answer all ${DRIFT_PROBES.length} probes.`)
  return parts.join('\n')
}

const driftOutSchema = z.object({
  answers: z.array(z.object({
    probeId: z.string().trim().min(1),
    answer: z.string().trim().min(1).max(DRIFT_ANSWER_MAX),
  })).min(1),
})

export interface ProbeAnswer {
  probeId: string
  answer: string
}

// Strict: every probe must be answered (first answer per id wins; unknown ids
// are ignored). Output follows the probe set's order.
export function parseDriftAnswers(text: string): ProbeAnswer[] {
  const out = driftOutSchema.parse(extractJsonBlock(text, 'drift probe'))
  const byId = new Map<string, string>()
  for (const a of out.answers) if (!byId.has(a.probeId)) byId.set(a.probeId, a.answer)
  const missing = DRIFT_PROBE_IDS.filter((id) => !byId.has(id))
  if (missing.length) throw new Error(`drift probe: missing answers for ${missing.join(', ')}`)
  return DRIFT_PROBE_IDS.map((probeId) => ({ probeId, answer: byId.get(probeId) as string }))
}
