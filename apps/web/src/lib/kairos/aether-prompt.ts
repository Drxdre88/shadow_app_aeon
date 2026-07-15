import { z } from 'zod'
import { neutraliseFences, extractJsonBlock as _extractJsonBlock } from './_prompt-utils'
import type { AetherPayload, AetherThought, AetherTension } from './aether-types'

// Kairos Aether (B3) — pure helpers (prompt builder, schema, renderer).
// Separated from aether.ts so tests can run without importing the DB module.

const aetherThoughtSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(80),
  insight: z.string().trim().min(10).max(800),
  dominionId: z.string().uuid().nullable().default(null),
  dominionName: z.string().trim().max(120).nullable().default(null),
  dominionColor: z.string().trim().max(40).nullable().default(null),
  salience: z.number().min(0).max(1),
  kind: z.enum(['conclusion', 'tension', 'connection', 'question', 'eureka']),
  sourceMemoryIds: z.array(z.string().uuid()).min(1),
  ageDays: z.number().int().min(0),
})

const aetherTensionSchema = z.object({
  aId: z.string().uuid(),
  bId: z.string().uuid(),
  note: z.string().trim().min(1).max(280),
})

export const aetherOutSchema = z.object({
  generatedAt: z.string().min(1),
  coreNarrative: z.string().trim().min(20).max(2000),
  thoughts: z.array(aetherThoughtSchema).min(1).max(20),
  tensions: z.array(aetherTensionSchema).max(10).default([]),
  shifts: z.array(z.string().trim().min(1).max(280)).max(8).default([]),
})

export interface CortexSnapshotRow {
  id: string
  dominionId: string
  dominionName: string
  dominionColor: string | null
  createdAt: Date
  visionAnchor: string | null
  currentState: string[]
  driftSignals: string[]
}

export interface GlobalReflectionRow {
  id: string
  dominionId: string | null
  dominionName: string | null
  title: string
  summary: string | null
  createdAt: Date
}

export interface GlobalArchetypeRow {
  id: string
  dominionId: string
  dominionName: string
  title: string
  summary: string | null
  themes: string[]
}

export interface PriorAetherRow {
  id: string
  createdAt: Date
  payload: AetherPayload | null
}

export interface AetherContext {
  userId: string
  today: string
  cortexSnapshots: CortexSnapshotRow[]
  topReflections: GlobalReflectionRow[]
  archetypes: GlobalArchetypeRow[]
  prior: PriorAetherRow | null
}

function renderCortexSnapshot(c: CortexSnapshotRow): string {
  const lines: string[] = [
    `### Dominion: ${neutraliseFences(c.dominionName)} (id:${c.dominionId})`,
  ]
  if (c.visionAnchor) lines.push(`vision_anchor: ${neutraliseFences(c.visionAnchor).slice(0, 300)}`)
  if (c.currentState.length) {
    lines.push('current_state:')
    lines.push(...c.currentState.slice(0, 5).map((s) => `  - ${neutraliseFences(s)}`))
  }
  if (c.driftSignals.length) {
    lines.push('drift_signals:')
    lines.push(...c.driftSignals.slice(0, 3).map((s) => `  - ${neutraliseFences(s)}`))
  }
  return lines.join('\n')
}

function renderReflectionLine(r: GlobalReflectionRow): string {
  const date = r.createdAt.toISOString().slice(0, 10)
  const dom = r.dominionName ? ` [${neutraliseFences(r.dominionName)}]` : ''
  const summary = r.summary ? ` — ${neutraliseFences(r.summary).slice(0, 180)}` : ''
  return `- [${r.id}]${dom} ${date}: ${neutraliseFences(r.title)}${summary}`
}

function renderArchetypeLine(a: GlobalArchetypeRow): string {
  const themes = a.themes.length ? ` [${a.themes.slice(0, 4).join(', ')}]` : ''
  const summary = a.summary ? ` — ${neutraliseFences(a.summary).slice(0, 180)}` : ''
  return `- [${a.id}] (${neutraliseFences(a.dominionName)})${themes} ${neutraliseFences(a.title)}${summary}`
}

function renderPriorAether(prior: PriorAetherRow | null): string {
  if (!prior?.payload) return '(no prior aether — first run)'
  const p = prior.payload
  const date = prior.createdAt.toISOString().slice(0, 10)
  const lines: string[] = [`(snapshot from ${date})`]
  lines.push(`core_narrative: ${neutraliseFences(p.coreNarrative).slice(0, 400)}`)
  if (p.shifts.length) {
    lines.push('prior_shifts:')
    lines.push(...p.shifts.map((s) => `  - ${neutraliseFences(s)}`))
  }
  if (p.thoughts.length) {
    lines.push('top_thoughts (salience desc):')
    const sorted = [...p.thoughts].sort((a, b) => b.salience - a.salience).slice(0, 6)
    lines.push(...sorted.map((t) => `  - [${t.kind}/${t.salience.toFixed(2)}] ${neutraliseFences(t.title)}`))
  }
  return lines.join('\n')
}

// Static instruction prefix — sent as the (cached) system block. Keep this
// free of per-run values so the Anthropic prompt-cache prefix stays stable.
export const AETHER_SYSTEM_PROMPT = [
  "You are Kairos, synthesising the global Aether — the operator's living self-model across ALL Dominions.",
  '',
  'The Aether is the highest-level synthesis: who this person is, what they are building across all their work, and what the cross-cutting patterns, tensions, and movements are. It is NOT a summary of any one Dominion — it is the shape they form together.',
  '',
  'Reflections carry HIGHER weight than activity signals. If a reflection contradicts an archetype, the reflection wins.',
  '',
  'Output requirements:',
  '- Return ONLY a JSON object inside a single ```json fenced block. No prose before or after.',
  '- Assign a fresh UUID v4 to every thought id.',
  '- Anti-drift rule: every thought MUST have at least one real memory id in sourceMemoryIds drawn from the ids shown above. Thoughts with no real grounding MUST be omitted.',
  '- Field rules:',
  '  - `generatedAt`: current UTC ISO 8601 timestamp.',
  '  - `coreNarrative`: 2–4 sentences. Who is this operator? What are they building across all their work? What is the overarching movement or arc? Honest, grounded, no flattery.',
  '  - `thoughts`: 5–15 items. Mix of kinds. Each:',
  '    - `id`: UUID v4 (fresh, unique)',
  '    - `title`: 1–3 words — a short tag, never a sentence (e.g. "Velocity Drift", "BYOK Gate")',
  '    - `insight`: one paragraph, ≤800 chars',
  '    - `dominionId`: UUID of the source Dominion, or null for cross-cutting',
  '    - `dominionName`: display name of the Dominion at generation time, or null',
  '    - `dominionColor`: color token (e.g. "purple") from the Dominion, or null',
  '    - `salience`: 0..1 — how central / load-bearing is this right now',
  '    - `kind`: conclusion | tension | connection | question | eureka',
  '    - `sourceMemoryIds`: array of real memory UUIDs from the substrate above (min 1)',
  '    - `ageDays`: integer, how many days old is the core source material',
  '  - `tensions`: 0–6 cross-Dominion or intra-Dominion tension pairs, each with `aId`, `bId` (thought ids), `note` (≤280 chars)',
  '  - `shifts`: 0–6 bullets — how this synthesis differs from the prior Aether. If first run, leave empty.',
  '',
  'Schema:',
  '```json',
  '{',
  '  "generatedAt": "2024-01-01T00:00:00.000Z",',
  '  "coreNarrative": "...",',
  '  "thoughts": [{',
  '    "id": "uuid-v4",',
  '    "title": "...",',
  '    "insight": "...",',
  '    "dominionId": "uuid-or-null",',
  '    "dominionName": "...",',
  '    "dominionColor": "...",',
  '    "salience": 0.8,',
  '    "kind": "eureka",',
  '    "sourceMemoryIds": ["uuid"],',
  '    "ageDays": 2',
  '  }],',
  '  "tensions": [{ "aId": "uuid", "bId": "uuid", "note": "..." }],',
  '  "shifts": ["..."]',
  '}',
  '```',
].join('\n')

// Per-run payload — date plus the operator's live cross-Dominion substrate.
export function buildAetherUserPrompt(ctx: AetherContext): string {
  const parts: string[] = [
    `Date: ${ctx.today}.`,
    '',
    '## Dominion cortex snapshots (latest per-Dominion synthesis)',
    ctx.cortexSnapshots.length === 0
      ? '(no Dominion cortex available — Dominions may be empty or cortex not yet generated)'
      : ctx.cortexSnapshots.map(renderCortexSnapshot).join('\n\n'),
    '',
    '## Top reflections across all Dominions (highest weight, most recent first)',
    ctx.topReflections.length === 0
      ? '(none yet)'
      : ctx.topReflections.map(renderReflectionLine).join('\n'),
    '',
    '## Cross-Dominion archetypes (today\'s fresh reading)',
    ctx.archetypes.length === 0
      ? '(none)'
      : ctx.archetypes.map(renderArchetypeLine).join('\n'),
    '',
    '## Prior Aether (detect shifts — what has changed since the last synthesis)',
    renderPriorAether(ctx.prior),
  ]
  return parts.join('\n')
}

// Combined single-string prompt (system + user). Kept for tests and any
// caller that doesn't split the request into cacheable blocks.
export function buildAetherPrompt(ctx: AetherContext): string {
  return [AETHER_SYSTEM_PROMPT, buildAetherUserPrompt(ctx)].join('\n\n')
}

export function extractJsonBlock(text: string): unknown {
  return _extractJsonBlock(text, 'aether')
}

export function renderAetherMarkdown(payload: AetherPayload, today: string): string {
  const lines: string[] = [
    `# Aether — global self-model (${today})`,
    '',
    '## Core narrative',
    payload.coreNarrative,
  ]

  if (payload.thoughts.length) {
    const byKind = (kind: AetherThought['kind']) => payload.thoughts.filter((t) => t.kind === kind)
    const renderThought = (t: AetherThought) => {
      const dom = t.dominionName ? ` _(${t.dominionName})_` : ''
      return `- **[${t.kind} / ${t.salience.toFixed(2)}]**${dom} **${t.title}** — ${t.insight.slice(0, 300)}`
    }

    const eurekas = byKind('eureka')
    if (eurekas.length) {
      lines.push('', '## Eurekas')
      lines.push(...eurekas.map(renderThought))
    }

    const conclusions = byKind('conclusion')
    if (conclusions.length) {
      lines.push('', '## Conclusions')
      lines.push(...conclusions.map(renderThought))
    }

    const connections = byKind('connection')
    if (connections.length) {
      lines.push('', '## Connections')
      lines.push(...connections.map(renderThought))
    }

    const questions = byKind('question')
    if (questions.length) {
      lines.push('', '## Open questions')
      lines.push(...questions.map(renderThought))
    }

    const tensionThoughts = byKind('tension')
    if (tensionThoughts.length) {
      lines.push('', '## Tensions (thought-level)')
      lines.push(...tensionThoughts.map(renderThought))
    }
  }

  if (payload.tensions.length) {
    lines.push('', '## Cross-cutting tensions')
    for (const t of payload.tensions) {
      lines.push(`- ${t.aId.slice(0, 8)} ↔ ${t.bId.slice(0, 8)}: ${t.note}`)
    }
  }

  if (payload.shifts.length) {
    lines.push('', '## Shifts since prior Aether')
    lines.push(...payload.shifts.map((s) => `- ${s}`))
  }

  return lines.join('\n')
}

// Re-export for callers that import only this module.
export type { AetherThought, AetherTension, AetherPayload }
