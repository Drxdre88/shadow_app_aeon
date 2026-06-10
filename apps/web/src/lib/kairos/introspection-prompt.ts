import { z } from 'zod'
import { neutraliseFences, extractJsonBlock as _extractJsonBlock } from './_prompt-utils'

// ─────────────────────────────────────────────────────────────────────────
// Kairos — Guided Introspection (propose-not-commit).
//
// Pure helpers for the introspection generator, split from introspection.ts so
// the prompt builder / JSON extractor / output schema / citation filter can be
// unit-tested without importing the DB module.
//
// The loop reads recent substrate for a Dominion and PROPOSES candidate
// thoughts (reflections, tensions, connections, questions) — it never commits
// a belief. Each proposal MUST cite ≥1 memory id it derived from; ungrounded
// proposals are discarded (the single biggest anti-drift lever). Proposals land
// as `type='inbound'` memories the operator reviews: committing a belief is
// done by the operator via kairos_reflect (their reflection is the real
// signal); dismissing is an archive. See docs/kairos/12-kairos-evolution-plan.
// ─────────────────────────────────────────────────────────────────────────

const proposalSchema = z.object({
  // reflection = candidate belief/priority · tension = contradiction/drift ·
  // connection = a link worth drawing between memories · question = a gap.
  kind: z.enum(['reflection', 'tension', 'connection', 'question']),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(800),
  // Memory ids this proposal is grounded in. Must reference the fed substrate.
  citations: z.array(z.string().uuid()).min(1).max(8),
  // Honest self-assessed strength of the inference, 0–1.
  confidence: z.number().min(0).max(1),
})

export type Proposal = z.infer<typeof proposalSchema>

export const introspectionOutSchema = z.object({
  proposals: z.array(proposalSchema).max(8).default([]),
})

export type IntrospectionOutput = z.infer<typeof introspectionOutSchema>

export interface IntrospectionMemoryRow {
  id: string
  title: string
  type: string
  summary: string | null
  createdAt: Date
}

export interface IntrospectionContext {
  dominionId: string
  name: string
  vision: string | null
  cortexBody: string | null
  recentMemories: IntrospectionMemoryRow[]
}

function renderMemory(m: IntrospectionMemoryRow): string {
  const date = m.createdAt.toISOString().slice(0, 10)
  const summary = m.summary ? ` — ${neutraliseFences(m.summary).slice(0, 200)}` : ''
  return `- [${m.id}] (${date} · ${m.type}) ${neutraliseFences(m.title)}${summary}`
}

export function buildIntrospectionPrompt(ctx: IntrospectionContext, today: string): string {
  const parts: string[] = [
    `You are Kairos, doing a controlled introspection pass over the "${ctx.name}" Dominion. Date: ${today}.`,
    '',
    'You are reading your own recent memory and proposing candidate thoughts for the operator to review. You are NOT deciding anything. These are suggestions; the operator accepts, rejects, or corrects them. Be useful and humble.',
    '',
    'Hard rules:',
    '- PROPOSE, do not assert. Frame beliefs as candidates.',
    '- Every proposal MUST cite ≥1 memory id from the list below, by its exact [id]. A proposal you cannot ground in cited memories will be DISCARDED — do not invent ids.',
    '- Prefer what the operator might MISS: tensions/contradictions, drift from the vision, and non-obvious connections between memories. Genuine open questions are welcome.',
    '- Set `confidence` honestly (0–1). Low confidence is fine and useful.',
    '- At most 6 proposals. Fewer, sharper proposals beat many weak ones. If nothing is worth surfacing, return an empty list.',
    '',
    '## Vision',
    ctx.vision || '(none set)',
    '',
    '## Current cortex (your existing model of this Dominion — do not just restate it; build on or challenge it)',
    ctx.cortexBody ? neutraliseFences(ctx.cortexBody).slice(0, 2000) : '(no cortex yet)',
    '',
    '## Recent memories (cite by [id])',
    ctx.recentMemories.length === 0
      ? '(none)'
      : ctx.recentMemories.map(renderMemory).join('\n'),
    '',
    '---',
    '',
    'Output requirements:',
    '- Return ONLY a JSON object inside a single ```json fenced block. No prose before or after.',
    '- `kind`: one of "reflection" | "tension" | "connection" | "question".',
    '- `title`: ≤120 chars. `body`: ≤800 chars, plain English.',
    '- `citations`: array of memory [id]s from the list above (≥1).',
    '- `confidence`: number 0–1.',
    '',
    'Schema:',
    '```json',
    '{',
    '  "proposals": [',
    '    { "kind": "tension", "title": "...", "body": "...", "citations": ["uuid"], "confidence": 0.6 }',
    '  ]',
    '}',
    '```',
  ]
  return parts.join('\n')
}

export function extractJsonBlock(text: string): unknown {
  return _extractJsonBlock(text, 'introspection')
}

// Anti-drift filter: keep only citations that reference memories we actually
// fed the model, and drop any proposal left with zero valid citations. This is
// what guarantees every surfaced proposal is grounded in real substrate.
export function filterGroundedProposals(out: IntrospectionOutput, validIds: Set<string>): Proposal[] {
  return out.proposals
    .map((p) => ({ ...p, citations: p.citations.filter((id) => validIds.has(id)) }))
    .filter((p) => p.citations.length > 0)
}
