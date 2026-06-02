import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (B1) — pure helpers for the Archetype Generator.
//
// Separated from archetypes.ts so unit tests can exercise the prompt
// builder + JSON extractor + output schema without importing the DB
// module (which boots a connection check at module load).
// ─────────────────────────────────────────────────────────────────────────

export const RECENT_WINDOW_DAYS = 14

export const archetypeOutSchema = z.object({
  archetypes: z.array(z.object({
    title: z.string().trim().min(1).max(80),
    summary: z.string().trim().min(1).max(300),
    // 100-800 matches the prompt instruction; we accept up to 2000 because
    // models sometimes overflow slightly and rejecting the whole run for a
    // 30-char overshoot wastes a BYOK call. 99-char floor stays strict —
    // we'd rather error and let tomorrow's run produce real content.
    body: z.string().trim().min(100).max(2000),
    themes: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
    citedMemoryIds: z.array(z.string().uuid()).max(20).default([]),
  })).min(1).max(10),
  shifts: z.array(z.string().trim().min(1).max(200)).max(5).default([]),
})

export type ArchetypeOutput = z.infer<typeof archetypeOutSchema>

export interface SubstrateRow {
  id: string
  title: string
  type: string
  streamClass: string
  summary: string | null
  pinned: boolean
  createdAt: Date
}

export interface ArchetypeContext {
  dominionId: string
  name: string
  vision: string | null
  missionLong: string | null
  objectives: Array<{ title: string; description: string | null; status: string }>
  boardTasks: Array<{ name: string; status: string; priority: string; projectName: string }>
  recent: SubstrateRow[]
  pinned: SubstrateRow[]
  reflections: SubstrateRow[]
  existing: SubstrateRow[]
}

// Defense in depth against prompt-injection via memory titles/summaries:
// strip triple-backtick sequences so a hostile substrate row cannot close
// the JSON fence the model is asked to emit. Substrate is userId-scoped
// so the blast radius is self-harm only, but the cost of escaping is zero.
function neutraliseFences(s: string): string {
  return s.replace(/```/g, "'''")
}

function renderMemoryLine(m: SubstrateRow): string {
  const tail = m.summary ? ` — ${neutraliseFences(m.summary).slice(0, 200)}` : ''
  return `- [${m.id}] (${m.streamClass}/${m.type}) ${neutraliseFences(m.title)}${tail}`
}

export function buildArchetypePrompt(ctx: ArchetypeContext, today: string): string {
  const parts: string[] = [
    `You are Kairos, synthesising the current shape of the "${ctx.name}" Dominion. Date: ${today}.`,
    '',
    'Your job: read the substrate below and emit 3–7 ARCHETYPES — master themes that capture what is actually shaping this Dominion right now. Each archetype is a synthesis, not a recap of any single memory.',
    '',
    'Reflections carry HIGHER weight than activity-derived signals. If a reflection contradicts activity, the reflection wins. If silence in an area, that is itself signal.',
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
    '## Open board cards',
    ctx.boardTasks.length === 0
      ? '(none open)'
      : ctx.boardTasks.map((t) => `- [${t.priority}/${t.status}] (${t.projectName}) ${t.name}`).join('\n'),
    '',
    '## Owner reflections (highest weight, chronological — most recent first)',
    ctx.reflections.length === 0
      ? '(none yet)'
      : ctx.reflections.map(renderMemoryLine).join('\n'),
    '',
    '## Pinned substrate (load-bearing, owner-selected)',
    ctx.pinned.length === 0
      ? '(none)'
      : ctx.pinned.map(renderMemoryLine).join('\n'),
    '',
    `## Recent substrate (last ${RECENT_WINDOW_DAYS} days)`,
    ctx.recent.length === 0
      ? '(none — Dominion has been quiet)'
      : ctx.recent.map(renderMemoryLine).join('\n'),
    '',
    "## Existing archetypes (yesterday's reading — evolve, merge, split, or replace)",
    ctx.existing.length === 0
      ? '(none — first run)'
      : ctx.existing.map((m) => `- [${m.id}] ${neutraliseFences(m.title)}${m.summary ? ` — ${neutraliseFences(m.summary)}` : ''}`).join('\n'),
    '',
    '---',
    '',
    'Output requirements:',
    '- Return ONLY a JSON object inside a single ```json fenced block. No prose before or after.',
    '- 3 to 7 archetypes. Quality over quantity — if the Dominion is quiet, prefer 3.',
    '- Each archetype:',
    '  - `title`: ≤80 chars, noun phrase, e.g. "Kairos brain build-out", "Beta auth hardening".',
    '  - `summary`: ≤300 chars, one-sentence synthesis (this is what surfaces in the cosmic view).',
    '  - `body`: 100–800 chars markdown — the *reading* of what is happening, why, and what to watch. Cite memory ids inline as `[mem:UUID]` when grounding a claim.',
    '  - `themes`: 1–5 short tags (lowercase kebab).',
    '  - `citedMemoryIds`: the memory ids you grounded this archetype in. Use the UUIDs shown above. 0 is allowed if the archetype is purely a vision/reflection synthesis.',
    '- `shifts`: 0–5 short notes describing how this reading differs from the existing archetypes shown above (if any).',
    '',
    'Schema:',
    '```json',
    '{',
    '  "archetypes": [',
    '    { "title": "...", "summary": "...", "body": "...", "themes": ["..."], "citedMemoryIds": ["..."] }',
    '  ],',
    '  "shifts": ["..."]',
    '}',
    '```',
  ]
  return parts.join('\n')
}

export function extractJsonBlock(text: string): unknown {
  // Prefer ```json ... ``` fenced; fall back to the first balanced {...} span.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('archetype generator: no JSON object found in response')
  }
  const json = candidate.slice(start, end + 1)
  return JSON.parse(json)
}
