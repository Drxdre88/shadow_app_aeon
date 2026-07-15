import { z } from 'zod'
import { neutraliseFences, extractJsonBlock as _extractJsonBlock } from './_prompt-utils'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (B2) — pure helpers for the Dominion Cortex generator.
//
// Separated from cortex.ts so unit tests can exercise the prompt builder,
// JSON extractor, output schema, and markdown renderer without importing
// the DB module (which boots a connection check at module load).
//
// The cortex is ONE living document per Dominion, regenerated nightly,
// that acts as Kairos's *model of how this Dominion is shaping*. It's:
//   - stored as `memories.bodyMd` (markdown — what the UI shows and what
//     Kairos uses as system-prompt prefix for any query about the Dominion)
//   - stored as `memories.sourceMetadata` (structured fields — queryable,
//     drivable from the graph / cosmic view, machine-readable for B4+)
// See docs/kairos/12-kairos-evolution-plan.md §"The Dominion Cortex".
// ─────────────────────────────────────────────────────────────────────────

const activeThreadSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(120),
  pulse: z.enum(['high', 'steady', 'low']).default('steady'),
  lastAdvance: z.string().trim().min(1).max(200),
})

export const cortexOutSchema = z.object({
  // 1–2 sentences. The "what this Dominion looks like right now" headline.
  visionAnchor: z.string().trim().min(20).max(800),
  currentState: z.array(z.string().trim().min(1).max(280)).min(1).max(8),
  activeThreads: z.array(activeThreadSchema).max(8).default([]),
  driftSignals: z.array(z.string().trim().min(1).max(280)).max(8).default([]),
  openQuestions: z.array(z.string().trim().min(1).max(280)).max(8).default([]),
  recentShifts: z.array(z.string().trim().min(1).max(280)).max(6).default([]),
})

export type CortexOutput = z.infer<typeof cortexOutSchema>

export interface ReflectionRow {
  id: string
  title: string
  summary: string | null
  createdAt: Date
}

export interface ArchetypeRow {
  id: string
  title: string
  summary: string | null
  themes: string[]
}

export interface PriorCortexRow {
  id: string
  createdAt: Date
  // The structured payload from sourceMetadata.cortex, if present. Used as
  // the "yesterday's reading" hint to detect recentShifts.
  payload: CortexOutput | null
}

export interface CortexContext {
  dominionId: string
  name: string
  vision: string | null
  missionLong: string | null
  objectives: Array<{ title: string; description: string | null; status: string }>
  boardTasks: Array<{ name: string; status: string; priority: string; projectName: string }>
  reflections: ReflectionRow[]
  archetypes: ArchetypeRow[]
  prior: PriorCortexRow | null
}

function renderReflection(r: ReflectionRow): string {
  const date = r.createdAt.toISOString().slice(0, 10)
  const summary = r.summary ? ` — ${neutraliseFences(r.summary).slice(0, 200)}` : ''
  return `- ${date}: ${neutraliseFences(r.title)}${summary}`
}

function renderArchetype(a: ArchetypeRow): string {
  const themes = a.themes.length ? ` [${a.themes.slice(0, 4).join(', ')}]` : ''
  const summary = a.summary ? ` — ${neutraliseFences(a.summary).slice(0, 200)}` : ''
  return `- [${a.id}] ${neutraliseFences(a.title)}${themes}${summary}`
}

function renderPriorThreads(prior: PriorCortexRow | null): string {
  if (!prior?.payload) return '(no prior cortex — first regen)'
  const p = prior.payload
  const date = prior.createdAt.toISOString().slice(0, 10)
  const parts: string[] = [`(snapshot from ${date})`]
  if (p.currentState.length) {
    parts.push('current_state:')
    parts.push(...p.currentState.map((s) => `  - ${neutraliseFences(s)}`))
  }
  if (p.activeThreads.length) {
    parts.push('active_threads:')
    parts.push(...p.activeThreads.map((t) => `  - [${t.pulse}] ${neutraliseFences(t.title)}`))
  }
  if (p.driftSignals.length) {
    parts.push('drift_signals:')
    parts.push(...p.driftSignals.map((s) => `  - ${neutraliseFences(s)}`))
  }
  return parts.join('\n')
}

// Static instruction prefix — sent as the (cached) system block. Keep this
// free of per-run values so the Anthropic prompt-cache prefix stays stable.
export const CORTEX_SYSTEM_PROMPT = [
  'You are Kairos, regenerating the living cortex for a single Dominion.',
  '',
  'The cortex is your *model of how this Dominion is shaping right now*. It is what you read first whenever the operator asks anything about this area, so it must be tight, honest, and grounded. Reflections carry HIGHER weight than activity-derived signals; if a reflection contradicts the activity, the reflection wins.',
  '',
  'Output requirements:',
  '- Return ONLY a JSON object inside a single ```json fenced block. No prose before or after.',
  '- Field rules:',
  '  - `visionAnchor`: 1–2 sentence headline. Restate the vision in your own words, anchored to the operator\'s current reality. Honest about scope drift if present.',
  '  - `currentState`: 2–6 bullets. What this Dominion *is* right now (rolled up from archetypes + reflections).',
  '  - `activeThreads`: 0–6 in-progress items, each with `title`, `pulse` (high/steady/low), `lastAdvance` (one sentence). Reference archetypes by `id` when applicable.',
  '  - `driftSignals`: 0–6 bullets — things stalled, ignored, or diverging from the vision. Each ≤280 chars.',
  '  - `openQuestions`: 0–6 bullets — gaps the substrate makes you wonder about. Questions, not assertions.',
  '  - `recentShifts`: 0–4 bullets — how today\'s reading differs from the prior cortex snapshot. If first regen, leave empty.',
  '',
  'Schema:',
  '```json',
  '{',
  '  "visionAnchor": "...",',
  '  "currentState": ["..."],',
  '  "activeThreads": [{ "id": "uuid?", "title": "...", "pulse": "high|steady|low", "lastAdvance": "..." }],',
  '  "driftSignals": ["..."],',
  '  "openQuestions": ["..."],',
  '  "recentShifts": ["..."]',
  '}',
  '```',
].join('\n')

// Per-run payload — Dominion identity, date, and the live substrate.
export function buildCortexUserPrompt(ctx: CortexContext, today: string): string {
  const parts: string[] = [
    `Dominion: "${ctx.name}". Date: ${today}.`,
    '',
    '## Vision',
    ctx.vision || '(none set)',
    '',
    '## Mission',
    ctx.missionLong || '(none set)',
    '',
    '## Open objectives',
    ctx.objectives.length === 0
      ? '(none)'
      : ctx.objectives.map((o) => `- [${o.status}] ${o.title}${o.description ? ` — ${o.description}` : ''}`).join('\n'),
    '',
    '## Open board cards (live)',
    ctx.boardTasks.length === 0
      ? '(none open)'
      : ctx.boardTasks.map((t) => `- [${t.priority}/${t.status}] (${t.projectName}) ${t.name}`).join('\n'),
    '',
    '## Owner reflections (highest weight, chronological — most recent first)',
    ctx.reflections.length === 0
      ? '(none yet)'
      : ctx.reflections.map(renderReflection).join('\n'),
    '',
    "## Today's archetypes (just synthesised — your fresh reading of the substrate)",
    ctx.archetypes.length === 0
      ? '(none — empty Dominion or archetype generator skipped)'
      : ctx.archetypes.map(renderArchetype).join('\n'),
    '',
    "## Prior cortex snapshot (yesterday's reading — detect recent_shifts by comparing to today)",
    renderPriorThreads(ctx.prior),
  ]
  return parts.join('\n')
}

// Combined single-string prompt (system + user). Kept for tests and any
// caller that doesn't split the request into cacheable blocks.
export function buildCortexPrompt(ctx: CortexContext, today: string): string {
  return [CORTEX_SYSTEM_PROMPT, buildCortexUserPrompt(ctx, today)].join('\n\n')
}

export function extractJsonBlock(text: string): unknown {
  return _extractJsonBlock(text, 'cortex')
}

// Render the structured cortex into the markdown body stored on the memory
// row. This is what the Kairos chat surface (B3+) prepends as system prompt
// for any query about the Dominion.
export function renderCortexMarkdown(ctx: CortexContext, payload: CortexOutput, today: string): string {
  const lines: string[] = [
    `# ${ctx.name} — cortex (${today})`,
    '',
    '## Vision anchor',
    payload.visionAnchor,
    '',
    '## Current state',
    ...payload.currentState.map((s) => `- ${s}`),
  ]
  if (payload.activeThreads.length) {
    lines.push('', '## Active threads')
    for (const t of payload.activeThreads) {
      const idRef = t.id ? ` _([${t.id.slice(0, 8)}])_` : ''
      lines.push(`- **[${t.pulse}]** ${t.title}${idRef} — ${t.lastAdvance}`)
    }
  }
  if (payload.driftSignals.length) {
    lines.push('', '## Drift signals')
    lines.push(...payload.driftSignals.map((s) => `- ${s}`))
  }
  if (payload.openQuestions.length) {
    lines.push('', '## Open questions')
    lines.push(...payload.openQuestions.map((q) => `- ${q}`))
  }
  if (payload.recentShifts.length) {
    lines.push('', '## Recent shifts')
    lines.push(...payload.recentShifts.map((s) => `- ${s}`))
  }
  if (ctx.reflections.length) {
    lines.push('', '## Reflection trail (load-bearing)')
    for (const r of ctx.reflections.slice(0, 6)) {
      const date = r.createdAt.toISOString().slice(0, 10)
      lines.push(`- ${date}: ${r.title}`)
    }
  }
  return lines.join('\n')
}
