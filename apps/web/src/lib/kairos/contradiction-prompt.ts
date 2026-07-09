import { z } from 'zod'
import { neutraliseFences, extractJsonBlock as _extractJsonBlock } from './_prompt-utils'

// ─────────────────────────────────────────────────────────────────────────
// Kairos — Contradiction detection (propose-not-commit).
//
// Pure helpers for the contradiction judge, split from contradiction.ts so
// the prompt builder / output schema / grounding filter can be unit-tested
// without importing the DB module.
//
// For a probe belief and its nearest semantic neighbours, ask the model
// whether any make a CONTRADICTORY claim — including IMPLICIT conflict (a
// newer state silently invalidating an older one), not just an explicit
// factual clash — and, if so, which is currently authoritative. A finding is
// never applied directly: runContradictionScanForDominion stages each
// grounded finding as a `type='inbound'` proposal the operator reviews via
// accept_proposal (mirrors introspection's propose-not-commit contract).
// ─────────────────────────────────────────────────────────────────────────

export interface ContradictionProbe {
  id: string
  title: string
  bodyMd: string
  type: string
  createdAt: Date
  confidence: number | null
}

export interface ContradictionCandidate {
  id: string
  title: string
  aiTitle: string | null
  bodyMd: string
  type: string
  createdAt: Date
  confidence: number | null
}

const findingSchema = z.object({
  // Must reference a candidate [id] fed to the model. Never invent an id.
  candidateId: z.string().uuid(),
  contradicts: z.boolean(),
  // Which side is currently authoritative when contradicts=true. Default
  // policy (more recent / higher confidence wins) is applied by the caller
  // that resolves winnerId/loserId; the model may override with rationale.
  winner: z.enum(['probe', 'candidate']),
  // Honest self-assessed certainty that this IS a contradiction, 0–1.
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().max(280),
})

export type ContradictionFinding = z.infer<typeof findingSchema>

export const contradictionOutSchema = z.object({
  findings: z.array(findingSchema).default([]),
})

export type ContradictionOutput = z.infer<typeof contradictionOutSchema>

function renderBelief(m: {
  id: string
  title: string
  bodyMd: string
  type: string
  createdAt: Date
  confidence: number | null
}): string {
  const date = m.createdAt.toISOString().slice(0, 10)
  const conf = m.confidence != null ? m.confidence.toFixed(2) : '?'
  const body = neutraliseFences(m.bodyMd).slice(0, 600)
  return `- [${m.id}] (${date} · ${m.type} · confidence ${conf}) ${neutraliseFences(m.title)}\n  ${body}`
}

export function buildContradictionPrompt(
  probe: ContradictionProbe,
  candidates: ContradictionCandidate[],
): string {
  const parts: string[] = [
    'You are Kairos, checking one belief against its nearest neighbours for contradictions.',
    '',
    'For EACH candidate below, decide whether it and the probe make a CONTRADICTORY claim — including IMPLICIT conflict (e.g. a newer state silently invalidating an older one), not just an explicit factual clash. You are NOT deciding anything final — this is a flagged notice for the operator to review.',
    '',
    'Hard rules:',
    '- Only flag genuine contradictions, not mere difference of topic, scope, or nuance.',
    '- If they contradict, decide which is currently AUTHORITATIVE. Default policy: more recent wins; if confidence differs significantly, higher confidence wins. You may override this default with a rationale if the content clearly warrants it.',
    '- `candidateId` MUST be one of the exact [id]s listed below. Never invent an id.',
    '- Set `confidence` honestly (0–1): your certainty that this IS a contradiction.',
    '- `rationale`: ≤280 chars, plain English, cite what conflicts.',
    '',
    '## Probe belief',
    renderBelief(probe),
    '',
    '## Candidates (nearest neighbours by semantic similarity)',
    candidates.map(renderBelief).join('\n'),
    '',
    '---',
    '',
    'Output requirements:',
    '- Return ONLY a JSON object inside a single ```json fenced block. No prose before or after.',
    '- One finding per candidate worth flagging. Candidates with no contradiction can be omitted entirely.',
    '',
    'Schema:',
    '```json',
    '{',
    '  "findings": [',
    '    { "candidateId": "uuid", "contradicts": true, "winner": "probe", "confidence": 0.8, "rationale": "..." }',
    '  ]',
    '}',
    '```',
  ]
  return parts.join('\n')
}

export function extractJsonBlock(text: string): unknown {
  return _extractJsonBlock(text, 'contradiction')
}

// Anti-drift filter: keep only findings whose candidateId references a real
// retrieved candidate — mirrors introspection's filterGroundedProposals.
export function filterGroundedFindings(
  out: ContradictionOutput,
  validIds: Set<string>,
): ContradictionFinding[] {
  return out.findings.filter((f) => validIds.has(f.candidateId))
}
