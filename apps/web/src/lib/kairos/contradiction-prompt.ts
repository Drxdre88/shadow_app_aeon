import { z } from 'zod'
import { neutraliseFences, extractJsonBlock as _extractJsonBlock } from './_prompt-utils'
import { makeFedIdResolver } from './introspection-prompt'

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
  // Must reference a candidate [id] fed to the model. Shape-only here: a
  // drifted or null id costs that one finding (filterGroundedFindings resolves
  // it against the fed candidates), never the whole probe.
  candidateId: z.string().trim().max(128).nullish(),
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
export type GroundedContradictionFinding = ContradictionFinding & { candidateId: string }

export const contradictionOutSchema = z.object({
  findings: z.array(findingSchema).default([]),
})

export type ContradictionOutput = z.infer<typeof contradictionOutSchema>

// Batch answer: `probes` is required (an empty list = a clean scan), so a
// JSON object of the wrong shape is rejected rather than read as "clean".
export const contradictionBatchOutSchema = z.object({
  probes: z.array(z.object({
    probeId: z.string().trim().max(128).nullish(),
    findings: z.array(findingSchema).default([]),
  })),
})

export type ContradictionBatchOutput = z.infer<typeof contradictionBatchOutSchema>

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

// Judging rules shared by the per-probe (cron) and batch (thinking job)
// prompts, so both reasoners judge a pair by the same standard.
const JUDGE_TASK = 'decide whether it and the probe make a CONTRADICTORY claim — including IMPLICIT conflict (e.g. a newer state silently invalidating an older one), not just an explicit factual clash. You are NOT deciding anything final — this is a flagged notice for the operator to review.'

function hardRules(idRule: string): string[] {
  return [
    'Hard rules:',
    '- Only flag genuine contradictions, not mere difference of topic, scope, or nuance.',
    '- If they contradict, decide which is currently AUTHORITATIVE. Default policy: more recent wins; if confidence differs significantly, higher confidence wins. You may override this default with a rationale if the content clearly warrants it.',
    idRule,
    '- Set `confidence` honestly (0–1): your certainty that this IS a contradiction.',
    '- `rationale`: ≤280 chars, plain English, cite what conflicts.',
  ]
}

const FINDING_EXAMPLE = '{ "candidateId": "uuid", "contradicts": true, "winner": "probe", "confidence": 0.8, "rationale": "..." }'

// Static instruction prefix — sent as the (cached) system block. Keep this
// free of per-run values so the Anthropic prompt-cache prefix stays stable.
export const CONTRADICTION_SYSTEM_PROMPT = [
  'You are Kairos, checking one belief against its nearest neighbours for contradictions.',
  '',
  `For EACH candidate below, ${JUDGE_TASK}`,
  '',
  ...hardRules('- `candidateId` MUST be one of the exact [id]s listed below. Never invent an id.'),
  '',
  'Output requirements:',
  '- Return ONLY a JSON object inside a single ```json fenced block. No prose before or after.',
  '- One finding per candidate worth flagging. Candidates with no contradiction can be omitted entirely.',
  '',
  'Schema:',
  '```json',
  '{',
  '  "findings": [',
  `    ${FINDING_EXAMPLE}`,
  '  ]',
  '}',
  '```',
].join('\n')

// Thinking-queue variant: every probe of one Dominion in a single call
// (the cron makes one call per probe). Same rules; each finding is grounded
// against the candidates of ITS probe only.
export const CONTRADICTION_BATCH_SYSTEM_PROMPT = [
  'You are Kairos, checking several beliefs (probes), each against its own nearest neighbours, for contradictions.',
  '',
  `For EACH probe below, and for EACH candidate listed under that probe, ${JUDGE_TASK}`,
  'Judge every probe independently: a candidate is compared only with the probe it is listed under.',
  '',
  ...hardRules('- `probeId` MUST be the exact [id] of a probe below, and every `candidateId` MUST be one of the exact [id]s listed under THAT probe. Never invent an id.'),
  '',
  'Output requirements:',
  '- Return ONLY a JSON object inside a single ```json fenced block. No prose before or after.',
  '- One entry per probe with a finding worth flagging; probes with none can be omitted. `{"probes": []}` is a valid answer.',
  '- Within a probe, one finding per candidate worth flagging. Candidates with no contradiction can be omitted entirely.',
  '',
  'Schema:',
  '```json',
  '{',
  '  "probes": [',
  '    {',
  '      "probeId": "uuid",',
  '      "findings": [',
  `        ${FINDING_EXAMPLE}`,
  '      ]',
  '    }',
  '  ]',
  '}',
  '```',
].join('\n')

// Per-run payload — the probe belief and its retrieved neighbours.
export function buildContradictionUserPrompt(
  probe: ContradictionProbe,
  candidates: ContradictionCandidate[],
): string {
  const parts: string[] = [
    '## Probe belief',
    renderBelief(probe),
    '',
    '## Candidates (nearest neighbours by semantic similarity)',
    candidates.map(renderBelief).join('\n'),
  ]
  return parts.join('\n')
}

export interface ContradictionBatchItem {
  probe: ContradictionProbe
  candidates: ContradictionCandidate[]
}

// Batch payload — each probe section is exactly the per-probe user prompt.
export function buildContradictionBatchUserPrompt(items: ContradictionBatchItem[]): string {
  return items
    .map((item, i) => [
      `### Probe ${i + 1} — probeId ${item.probe.id}`,
      buildContradictionUserPrompt(item.probe, item.candidates),
    ].join('\n'))
    .join('\n\n')
}

// Combined single-string prompt (system + user). Kept for tests and any
// caller that doesn't split the request into cacheable blocks.
export function buildContradictionPrompt(
  probe: ContradictionProbe,
  candidates: ContradictionCandidate[],
): string {
  return [CONTRADICTION_SYSTEM_PROMPT, buildContradictionUserPrompt(probe, candidates)].join('\n\n')
}

export function extractJsonBlock(text: string): unknown {
  return _extractJsonBlock(text, 'contradiction')
}

// Anti-drift filter: keep only findings whose candidateId resolves to a real
// retrieved candidate, rewritten to the canonical fed id (shares introspection's
// exact / unique-prefix resolver).
export function filterGroundedFindings(
  out: ContradictionOutput,
  validIds: Set<string>,
): GroundedContradictionFinding[] {
  const resolve = makeFedIdResolver(validIds)
  return out.findings.flatMap((f) => {
    const candidateId = resolve(f.candidateId)
    return candidateId ? [{ ...f, candidateId }] : []
  })
}

export interface GroundedProbeFindings {
  probeId: string
  findings: GroundedContradictionFinding[]
}

// Batch anti-drift filter: probeId resolves against the fed probes, then each
// finding's candidateId against THAT probe's candidates only — a finding
// citing another probe's candidate is dropped. Repeated probe entries merge.
export function filterGroundedBatchFindings(
  out: ContradictionBatchOutput,
  candidateIdsByProbe: Map<string, Set<string>>,
): GroundedProbeFindings[] {
  const resolveProbe = makeFedIdResolver(candidateIdsByProbe.keys())
  const byProbe = new Map<string, GroundedContradictionFinding[]>()
  for (const entry of out.probes) {
    const probeId = resolveProbe(entry.probeId)
    if (!probeId) continue
    const findings = filterGroundedFindings({ findings: entry.findings }, candidateIdsByProbe.get(probeId) ?? new Set())
    if (findings.length) byProbe.set(probeId, [...(byProbe.get(probeId) ?? []), ...findings])
  }
  return [...byProbe].map(([probeId, findings]) => ({ probeId, findings }))
}
