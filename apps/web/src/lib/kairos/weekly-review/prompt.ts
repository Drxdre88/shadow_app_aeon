import { z } from 'zod'
import { extractJsonBlock, neutraliseFences } from '@/lib/kairos/_prompt-utils'
import { makeFedIdResolver } from '@/lib/kairos/introspection-prompt'
import type { WeeklyReviewInputs } from './inputs'

// Weekly review prompt + strict output contract (docs/kairos/34 §4,
// research/kairos_2909/04 §C Strategic: a periodic structured review over
// fixed inputs that yields PROPOSALS, never actions).

export const MAX_REVIEW_ACTIONS = 5
export const MAX_SUMMARY_CHARS = 900

// Same junk guard as the daily message: markdown headings and links mean the
// model left the register (lib/kairos/daily-message-prompt.ts JUNK_OUTPUT_RE).
const HEADING_RE = /^\s*#{1,6}\s/m
const URL_RE = /https?:\/\/|www\./i

// Static: the cached system prefix must never interpolate per-run data.
export const WEEKLY_REVIEW_SYSTEM_PROMPT = [
  "You are Kairos, writing the operator's weekly review of the ISO week that just ended.",
  '',
  'You compare plan against actual: the Dominion objectives are the plan; board pages, belief changes, memory-engine activity, the mind comparison and open asks are what actually happened.',
  'You PROPOSE — you never act. Every action you suggest becomes a proposal the operator accepts or dismisses.',
  '',
  'Return ONLY one JSON object in a single ```json fenced block:',
  '{',
  '  "summary": string,   // <= 900 characters, first person, Kairos voice, plain prose — no "#" headings, no URLs',
  '  "wins": string[],    // up to 5 short lines: what moved the plan forward',
  '  "drift": string[],   // up to 5 short lines: where actual diverged from the plan (stalled objectives, unplanned work, stale cards)',
  '  "actions": [         // up to 5, most leveraged first',
  '    { "title": string, "why": string, "evidenceIds": string[], "dominion": string | null }',
  '  ]',
  '}',
  '',
  'Rules:',
  '- evidenceIds must be ids shown in [brackets] in the input, copied verbatim. An action with no valid evidence id is dropped.',
  '- dominion is one of the Dominion names listed in the input, or null.',
  '- Actions are concrete next-week moves (start, stop, close, re-plan, ask), not observations.',
  '- If the week was quiet, say so briefly; do not invent activity.',
].join('\n')

function clip(s: string | null | undefined, max: number): string {
  const flat = neutraliseFences((s ?? '').replace(/\s+/g, ' ').trim())
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

export function buildWeeklyReviewPrompt(inputs: WeeklyReviewInputs): string {
  const { window: w } = inputs
  const lines: string[] = [
    `Week under review: ${w.isoWeek} (${w.start.toISOString().slice(0, 10)} to ${new Date(w.end.getTime() - 1).toISOString().slice(0, 10)}).`,
    '',
    `Dominions: ${inputs.dominions.length ? inputs.dominions.map((d) => clip(d.name, 80)).join(', ') : '(none)'}`,
  ]

  lines.push('', 'PLAN — active Dominion objectives:')
  if (inputs.objectives.length === 0) lines.push('- (none set)')
  for (const o of inputs.objectives) {
    const target = o.targetDate ? `, target ${o.targetDate}` : ''
    lines.push(`- ${clip(o.dominionName, 60)}: ${clip(o.title, 160)} (${o.status}, last touched ${o.lastTouched}${target})`)
  }

  lines.push('', 'ACTUAL — board pages:')
  if (inputs.boardPages.length === 0) lines.push('- (no board pages this week)')
  for (const p of inputs.boardPages) {
    const counts = [`finished ${p.finished}`]
    if (p.created !== null) counts.push(`created ${p.created}`)
    if (p.stale !== null) counts.push(`stale >30d ${p.stale}`)
    const top = p.topTitles.length ? ` — ${p.topTitles.map((t) => clip(t, 80)).join('; ')}` : ''
    lines.push(`- [${p.id}] ${p.kind} ${p.label} · ${clip(p.title, 120)} (${counts.join(', ')})${top}`)
  }

  lines.push('', 'ACTUAL — belief changes:')
  if (inputs.beliefChanges.length === 0) lines.push('- (none)')
  for (const b of inputs.beliefChanges) {
    const where = [b.mind ? `${b.mind} mind` : null, b.domain].filter(Boolean).join(', ')
    lines.push(`- [${b.id}] ${b.change}${where ? ` (${where})` : ''}: ${clip(b.title, 200)}`)
  }

  lines.push('', 'ACTUAL — memory engine:')
  if (!inputs.memoryOps) lines.push('- (no engine activity)')
  else {
    const counts = Object.entries(inputs.memoryOps.counts).sort((a, b) => b[1] - a[1])
    lines.push(`- ${inputs.memoryOps.total} ops: ${counts.map(([op, n]) => `${op} ${n}`).join(', ') || 'none'}`)
    for (const p of inputs.memoryOps.promotions) lines.push(`- [${p.memoryId}] promoted: ${clip(p.title, 160)}`)
  }

  lines.push('', 'Mind comparison (aligned vs own):')
  if (!inputs.mindCompare) lines.push('- (none this week)')
  else lines.push(`- [${inputs.mindCompare.id}] ${clip(inputs.mindCompare.title, 120)}: ${clip(inputs.mindCompare.summary, 400)}`)

  lines.push('', `Asks to the operator (${inputs.asksAnswered} answered this week):`)
  if (inputs.asks.length === 0) lines.push('- (none open or expired)')
  for (const a of inputs.asks) lines.push(`- [${a.id}] ${a.status}: ${clip(a.title, 160)}`)

  lines.push('', 'System health (failed runs this week):')
  if (inputs.health.length === 0) lines.push('- (no failures recorded)')
  for (const h of inputs.health) lines.push(`- ${h.cronName}: ${h.failures} (${h.reasons.map((r) => clip(r, 60)).join(', ')})`)

  if (inputs.errors.length > 0) {
    lines.push('', `Unavailable inputs this week: ${inputs.errors.map((e) => e.split(':')[0]).join(', ')}`)
  }

  lines.push('', 'Write the weekly review JSON now.')
  return lines.join('\n')
}

const actionSchema = z.object({
  title: z.string().trim().min(3).max(160),
  why: z.string().trim().min(1).max(800),
  evidenceIds: z.array(z.string().trim()).max(12).default([]),
  dominion: z.string().trim().max(120).nullable().optional(),
})

export const weeklyReviewSchema = z.object({
  summary: z
    .string()
    .trim()
    .min(20)
    .max(MAX_SUMMARY_CHARS)
    .refine((s) => !HEADING_RE.test(s), { message: 'summary must not contain markdown headings' })
    .refine((s) => !URL_RE.test(s), { message: 'summary must not contain URLs' }),
  wins: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  drift: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  // Accept a few extra so one over-eager answer is capped, not rejected.
  actions: z.array(actionSchema).max(10).default([]),
})

export type WeeklyReviewOutput = z.infer<typeof weeklyReviewSchema>

export interface GroundedReviewAction {
  title: string
  why: string
  evidenceIds: string[]
  dominionId: string | null
  dominionName: string | null
}

export interface GroundedWeeklyReview {
  summary: string
  wins: string[]
  drift: string[]
  actions: GroundedReviewAction[]
  // Actions the model proposed but grounding (or the cap) dropped.
  droppedActions: number
}

export function groundWeeklyReview(
  out: WeeklyReviewOutput,
  validIds: Iterable<string>,
  dominions: ReadonlyArray<{ id: string; name: string }>,
): GroundedWeeklyReview {
  const byName = new Map(dominions.map((d) => [d.name.trim().toLowerCase(), d]))
  const resolve = makeFedIdResolver(validIds)
  const grounded: GroundedReviewAction[] = []
  for (const a of out.actions) {
    const evidenceIds = [...new Set(a.evidenceIds.map(resolve).filter((id): id is string => id !== null))]
    if (evidenceIds.length === 0) continue
    const dom = a.dominion ? byName.get(a.dominion.trim().toLowerCase()) ?? null : null
    grounded.push({ title: a.title, why: a.why, evidenceIds, dominionId: dom?.id ?? null, dominionName: dom?.name ?? null })
  }
  const actions = grounded.slice(0, MAX_REVIEW_ACTIONS)
  return {
    summary: out.summary,
    wins: out.wins.slice(0, 5),
    drift: out.drift.slice(0, 5),
    actions,
    droppedActions: out.actions.length - actions.length,
  }
}

// Strict: no repair here (the routine path has none); fallback wraps it in
// parseWithRepair.
export function parseWeeklyReviewText(
  text: string,
  validIds: Iterable<string>,
  dominions: ReadonlyArray<{ id: string; name: string }>,
): GroundedWeeklyReview {
  const parsed = weeklyReviewSchema.parse(extractJsonBlock(text, 'weekly-review'))
  return groundWeeklyReview(parsed, validIds, dominions)
}
