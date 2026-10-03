import { z } from 'zod'
import { IDEA_KINDS, IDEA_LEAPS, type IdeaKind, type IdeaLeap } from '../types'
import { dataLine } from '../prompt-data'
import { ATLAS_CROSS_AREA, type AtlasCellRef } from './cells'

// Atlas prompt pieces (lane A). Only used when KAIROS_IDEA_ATLAS is on or
// observing; with the flag off no line here reaches a prompt.

export const ATLAS_GENERATE_SYSTEM_LINES: readonly string[] = [
  'Atlas tags: every candidate ALSO carries "kind" and "leap".',
  '- kind: "question" (an open question worth asking), "experiment" (a small test with a result), "reframe" (a new way to see something), "make" (something to build or write), or "ritual" (a recurring practice).',
  '- leap: "near" (builds on one area as it is) or "far" (connects distant areas, or departs sharply from what exists). Claim "far" only when it truly is; it is checked against the evidence.',
  'So each candidate object also has "kind":"question|experiment|reframe|make|ritual" and "leap":"near|far".',
]

export const withAtlasSystem = (system: string): string => [system, ...ATLAS_GENERATE_SYSTEM_LINES].join('\n')

const KIND_LABEL: Record<IdeaKind, string> = {
  question: 'a question',
  experiment: 'an experiment',
  reframe: 'a reframe',
  make: 'something to make',
  ritual: 'a ritual',
}

export function areaName(area: string, names: ReadonlyMap<string, string>): string {
  return area === ATLAS_CROSS_AREA ? 'cross-cutting' : names.get(area) ?? 'an area'
}

// Spliced as the last block inside the generate data markers ('on' mode only).
export function renderAtlasTargets(targets: readonly AtlasCellRef[], names: ReadonlyMap<string, string>): string {
  const lines = ['## Atlas gaps (kinds of idea not tried yet; aim a few candidates here, not citable)']
  for (const t of targets) lines.push(`- ${dataLine(areaName(t.area, names), 60)} · ${KIND_LABEL[t.kind]} · ${t.leap} leap`)
  return lines.join('\n')
}

const tagSchema = z.object({
  kind: z.enum(IDEA_KINDS).optional().catch(undefined),
  leap: z.enum(IDEA_LEAPS).optional().catch(undefined),
})

// Kind and leap from one raw candidate item; invalid or missing → absent.
export function readAtlasTags(rawItem: unknown): { kind?: IdeaKind; leap?: IdeaLeap } {
  if (!rawItem || typeof rawItem !== 'object') return {}
  const raw = rawItem as Record<string, unknown>
  const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v)
  const parsed = tagSchema.safeParse({ kind: norm(raw.kind), leap: norm(raw.leap) })
  if (!parsed.success) return {}
  const out: { kind?: IdeaKind; leap?: IdeaLeap } = {}
  if (parsed.data.kind) out.kind = parsed.data.kind
  if (parsed.data.leap) out.leap = parsed.data.leap
  return out
}

// ── Judge: anonymous cell holders ("an earlier idea") ──────────────────────

export interface JudgeHolder {
  // h1..hN — what the judge answers by.
  id: string
  title: string
  claim: string
}

export const ATLAS_JUDGE_SYSTEM_LINE =
  'Some matches pit a candidate against "an earlier idea" (keys h1, h2, …): vote on those matches like any other, but never critique or refine an earlier idea.'

export function renderHolderSection(holders: readonly JudgeHolder[]): string[] {
  if (holders.length === 0) return []
  const lines = ['', '## Earlier ideas (match opponents only; do not critique)']
  for (const h of holders) {
    lines.push('', `### ${h.id} · an earlier idea`)
    lines.push(`Title: ${dataLine(h.title, 140)}`)
    lines.push(`Claim: ${dataLine(h.claim, 300)}`)
  }
  return lines
}
