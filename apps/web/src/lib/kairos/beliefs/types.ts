import { z } from 'zod'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'
import { neutraliseFences } from '@/lib/kairos/_prompt-utils'
import type { EngineLink } from '@/lib/kairos/engine/types'

// Belief ledger (docs/kairos/34 §1): one claim per `belief` memory, held by the
// aligned mind (the operator's own words) or the own mind (Kairos's view).
// sourceMetadata.belief is the v1 contract below — exactly the doc's shape.

export const BELIEF_TYPE = 'belief'
export const BELIEF_STREAM = 'belief'
export const BELIEF_STEP = 'beliefs'
export const GENERAL_DOMAIN = 'general'
export const OWN_UNKNOWN_FALSIFIER = 'unknown — not yet stated'

export const BELIEF_MINDS = ['aligned', 'own'] as const
export const BELIEF_SOURCE_TYPES = ['operator', 'tool', 'inference'] as const
export const BELIEF_STATUSES = ['held', 'retired'] as const

export type BeliefMind = (typeof BELIEF_MINDS)[number]
export type BeliefStatus = (typeof BELIEF_STATUSES)[number]

export const beliefV1Schema = z.object({
  v: z.literal(1),
  mind: z.enum(BELIEF_MINDS),
  domain: z.string().min(1),
  dominionId: z.string().nullable(),
  claim: z.string().min(1),
  reasons: z.array(z.string()),
  falsifier: z.string().min(1),
  sourceType: z.enum(BELIEF_SOURCE_TYPES),
  provenance: z.array(z.string()),
  status: z.enum(BELIEF_STATUSES),
  confidence: z.number().min(0).max(1),
  supersedes: z.string().optional(),
}).strict()

export type BeliefV1 = z.infer<typeof beliefV1Schema>

export function readBelief(sourceMetadata: unknown): BeliefV1 | null {
  if (!sourceMetadata || typeof sourceMetadata !== 'object') return null
  const parsed = beliefV1Schema.safeParse((sourceMetadata as Record<string, unknown>).belief)
  return parsed.success ? parsed.data : null
}

export interface DominionRef {
  id: string
  name: string
}

// A domain is a Dominion name (case-insensitive) or 'general'.
export function resolveDomain(raw: unknown, dominions: readonly DominionRef[]): { domain: string; dominionId: string | null } {
  const wanted = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  const hit = wanted ? dominions.find((d) => d.name.trim().toLowerCase() === wanted) : undefined
  return hit ? { domain: hit.name, dominionId: hit.id } : { domain: GENERAL_DOMAIN, dominionId: null }
}

export function oneLine(s: string): string {
  return neutraliseFences(s).replace(/\s+/g, ' ').trim()
}

export function renderBeliefMarkdown(b: BeliefV1): string {
  const lines = [`# ${oneLine(b.claim)}`, '', `*${b.mind} mind · ${b.domain} · confidence ${b.confidence.toFixed(2)}*`]
  if (b.reasons.length) lines.push('', '## Reasons', ...b.reasons.map((r) => `- ${oneLine(r)}`))
  lines.push('', `**Would change my mind:** ${oneLine(b.falsifier)}`)
  if (b.provenance.length) lines.push('', `Sources: ${b.provenance.map((id) => `[${id}]`).join(' ')}`)
  return lines.join('\n')
}

export interface BeliefRowValues {
  dominionId: string | null
  title: string
  bodyMd: string
  summary: string
  type: typeof BELIEF_TYPE
  streamClass: typeof BELIEF_STREAM
  confidence: number
  links: EngineLink[]
  tags: string[]
  sourceMetadata: Record<string, unknown>
}

// The memory row for one belief; `extra` carries row-level bookkeeping
// (idempotency keys, job id) beside — never inside — the v1 belief payload.
export function beliefRowValues(belief: BeliefV1, extra: Record<string, unknown> = {}): BeliefRowValues {
  const claim = oneLine(belief.claim)
  return {
    dominionId: belief.dominionId,
    title: claim.slice(0, 255),
    bodyMd: renderBeliefMarkdown(belief),
    summary: claim.slice(0, 1000),
    type: BELIEF_TYPE,
    streamClass: BELIEF_STREAM,
    confidence: confidenceForStreamClass(BELIEF_STREAM),
    links: belief.provenance.map((target) => ({ type: 'refers_to', target, target_kind: 'memory' })),
    tags: ['belief', `mind:${belief.mind}`],
    sourceMetadata: { ...extra, kind: 'belief', belief: beliefV1Schema.parse(belief) },
  }
}
