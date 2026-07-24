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

// Clamp instead of reject: an over-long title must degrade to an ellipsis,
// not kill the Dominion's whole night. The 2026-07-23 healing run showed the
// repair round-trip fixing JSON syntax only for .max() to reject titles a few
// chars over — the dominant remaining kill-path after PR #95.
const clampedString = (max: number) =>
  z.string().trim().min(1).transform((s) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s))

// Citations arrive messy on bad nights: shortened to an 8-char prefix, wrapped
// in brackets, a bare string, or the array omitted entirely (2026-07-24 Shadow
// Apps trace: all 5 proposals lost the field, and .uuid()/.min(1) turned that
// into a whole-night kill). Grounding is enforced by filterGroundedProposals
// against the actual fed substrate — the schema only needs shape.
const citationsSchema = z.preprocess(
  (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v : []),
  z.array(z.string()).transform((a) => a.slice(0, 8)),
)

const proposalSchema = z.object({
  // reflection = candidate belief/priority · tension = contradiction/drift ·
  // connection = a link worth drawing between memories · question = a gap.
  kind: z.enum(['reflection', 'tension', 'connection', 'question']),
  title: clampedString(120),
  body: clampedString(800),
  // Memory ids this proposal is grounded in. Must reference the fed substrate.
  citations: citationsSchema,
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

// Static instruction prefix — sent as the (cached) system block. Keep this
// free of per-run values so the Anthropic prompt-cache prefix stays stable.
export const INTROSPECTION_SYSTEM_PROMPT = [
  'You are Kairos, doing a controlled introspection pass over a single Dominion.',
  '',
  'You are reading your own recent memory and proposing candidate thoughts for the operator to review. You are NOT deciding anything. These are suggestions; the operator accepts, rejects, or corrects them. Be useful and humble.',
  '',
  'Hard rules:',
  '- PROPOSE, do not assert. Frame beliefs as candidates.',
  '- Every proposal MUST cite ≥1 memory id from the list below, by its exact [id]. Copy each id IN FULL — a shortened or truncated id cannot be verified. A proposal you cannot ground in cited memories will be DISCARDED — do not invent ids.',
  '- Prefer what the operator might MISS: tensions/contradictions, drift from the vision, and non-obvious connections between memories. Genuine open questions are welcome.',
  '- Set `confidence` honestly (0–1). Low confidence is fine and useful.',
  '- At most 6 proposals. Fewer, sharper proposals beat many weak ones. If nothing is worth surfacing, return an empty list.',
  '',
  'Output requirements:',
  '- Return ONLY a JSON object inside a single ```json fenced block. No prose before or after.',
  '- `kind`: one of "reflection" | "tension" | "connection" | "question".',
  '- `title`: ≤120 chars. `body`: ≤800 chars, plain English.',
  '- `citations`: array of memory [id]s from the list above (≥1), each copied in full — never shortened.',
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
].join('\n')

// Per-run payload — Dominion identity, date, and the live substrate.
export function buildIntrospectionUserPrompt(ctx: IntrospectionContext, today: string): string {
  const parts: string[] = [
    `Dominion: "${ctx.name}". Date: ${today}.`,
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
  ]
  return parts.join('\n')
}

// Combined single-string prompt (system + user). Kept for tests and any
// caller that doesn't split the request into cacheable blocks.
export function buildIntrospectionPrompt(ctx: IntrospectionContext, today: string): string {
  return [INTROSPECTION_SYSTEM_PROMPT, buildIntrospectionUserPrompt(ctx, today)].join('\n\n')
}

export function extractJsonBlock(text: string): unknown {
  return _extractJsonBlock(text, 'introspection')
}

// Models cite ids as "[3b11ff33]" or a bare prefix despite the full-id rule.
// Strip decoration and lowercase so an honest-but-messy citation still gets a
// chance to resolve against the substrate.
function normaliseCitationId(raw: string): string {
  return raw.trim().replace(/^[[`'"]+|[\]`'"]+$/g, '').trim().toLowerCase()
}

// Anti-drift filter: keep only citations that resolve to memories we actually
// fed the model, and drop any proposal left with zero valid citations. This is
// what guarantees every surfaced proposal is grounded in real substrate.
// A citation resolves by exact id, or by a UNIQUE prefix of ≥8 chars (models
// shorten uuids to their first block; a unique prefix is still real evidence).
// An unresolvable citation costs that one proposal, never the whole run.
export function filterGroundedProposals(out: IntrospectionOutput, validIds: Set<string>): Proposal[] {
  const ids = [...validIds]
  const resolve = (raw: string): string | null => {
    const c = normaliseCitationId(raw)
    if (validIds.has(c)) return c
    if (/^[0-9a-f][0-9a-f-]{7,}$/.test(c)) {
      const matches = ids.filter((id) => id.startsWith(c))
      if (matches.length === 1) return matches[0]
    }
    return null
  }
  return out.proposals
    .map((p) => {
      const citations = [...new Set(p.citations.map(resolve).filter((id): id is string => id !== null))]
      return { ...p, citations }
    })
    .filter((p) => p.citations.length > 0)
}
