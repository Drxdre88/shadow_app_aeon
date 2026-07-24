import { neutraliseFences } from './_prompt-utils'

// ─────────────────────────────────────────────────────────────────────────
// Kairos — Micro-consolidation prompt builder (pure, DB-free).
//
// Plain-text output (not JSON) — same contract as briefer.ts/digest-prompt.ts:
// the model writes a short prose fold, no schema/parse-repair round-trip
// needed. Separated from micro-consolidate.ts so it can be unit-tested
// without importing the DB module.
// ─────────────────────────────────────────────────────────────────────────

export interface MicroConsolidateNewMemory {
  title: string
  type: string
  streamClass: string
}

export interface MicroConsolidateContext {
  dominionId: string
  dominionName: string
  since: Date
  now: Date
  newMemories: MicroConsolidateNewMemory[]
  tasksCompleted: number
  tasksCreated: number
}

// Static instruction prefix — sent as the (cached) system block. Keep this
// free of per-run values so the Anthropic prompt-cache prefix stays stable.
export const MICRO_CONSOLIDATE_SYSTEM_PROMPT = [
  'You are Kairos, writing a compact intraday delta note for a single Dominion.',
  '',
  "This is NOT a full synthesis — it's a running tally the nightly cortex, aether, and archetype generators will read back as \"Today so far\" grounding before their own full read of the substrate.",
  '',
  'Output requirements:',
  '- Plain text only. No JSON, no markdown headers, no bullet-point formatting — 2–5 tight sentences.',
  '- Summarise what changed since the last reading: the shape of the new memories (not a bare list) and any board movement.',
  '- Honest and specific. If nothing meaningful moved beyond routine activity, say so in one sentence.',
  '- Under 150 words. No preamble, no sign-off — start directly with the content.',
].join('\n')

function renderNewMemoryLine(m: MicroConsolidateNewMemory): string {
  return `- [${m.type}/${m.streamClass}] ${neutraliseFences(m.title)}`
}

// Per-run payload — Dominion identity, window, and the interval's substrate.
export function buildMicroConsolidateUserPrompt(ctx: MicroConsolidateContext): string {
  const parts: string[] = [
    `Dominion: "${neutraliseFences(ctx.dominionName)}". Window: ${ctx.since.toISOString()} → ${ctx.now.toISOString()}.`,
    '',
    '## New memories this window',
    ctx.newMemories.length === 0
      ? '(none)'
      : ctx.newMemories.map(renderNewMemoryLine).join('\n'),
    '',
    '## Board movement this window',
    `- Tasks completed: ${ctx.tasksCompleted}`,
    `- Tasks created: ${ctx.tasksCreated}`,
  ]
  return parts.join('\n')
}
