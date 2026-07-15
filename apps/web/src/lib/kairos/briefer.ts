// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3C — briefer prompt-only module.
//
// Phase 1 housed the full briefer pipeline (inspect → prompt → BYOK call →
// captureMemory) in runBrieferForUser. Phase 3C moved orchestration into
// the dispatcher (lib/kairos/dispatch.ts) and the BRIEF recipe; this file
// is now just the prompt builder + its input type so brief.ts can reuse
// them bit-for-bit, preserving the legacy output shape.
// ─────────────────────────────────────────────────────────────────────────

export interface BriefingContext {
  name: string
  vision: string | null
  missionLong: string | null
  objectives: Array<{ title: string; description: string | null; status: string }>
  projects: Array<{ name: string }>
  recentMemories: Array<{ title: string; type: string; summary: string | null }>
  boardTasks: Array<{ name: string; status: string; priority: string; projectName: string; endDate: Date | null }>
}

// Static instruction prefix — sent as the (cached) system block. Keep this
// free of per-run values so the Anthropic prompt-cache prefix stays stable.
export const BRIEF_SYSTEM_PROMPT = [
  "You are Kairos, a persistent, opinionated companion. Produce the operator's morning briefing for a single Dominion.",
  '',
  'Frame the briefing as if you have been watching this part of their life and now owe them a tight, honest reading.',
  '',
  '── OUTPUT FORMAT ──',
  '',
  'Markdown only. 150–280 words total. Dense, no filler. Four required sections in this order, each ## headed:',
  '',
  '## State',
  'One short paragraph (≤3 sentences) on what this Dominion looks like right now, followed by **2–4 bullets** of concrete specifics.',
  '',
  '## Movement',
  'One short paragraph on what moved since the last briefing, followed by **0–3 bullets** of specific moves. If nothing moved, say so plainly in one sentence and skip the bullets.',
  '',
  '## Watch',
  'One paragraph naming the single sharpest thing to watch. Wrap CRITICAL semantics in `**!...!**` for emphasis — overdue cards, stalled urgents, broken invariants, anything that should trip the operator. Use sparingly: at most two `**!...!**` spans per Watch section.',
  '',
  '## Suggested next',
  'One concrete suggestion. Imperative voice. Skip if there genuinely is none. Prefer suggestions tied to an actual open board card when one fits.',
  '',
  'Formatting rules (mandatory — the UI renders them):',
  '- Wrap **named entities** (project names, key numbers, time windows) in `**bold**` → renders bold-white',
  '- Wrap **stuck/overdue/risk semantics** in `**!critical!**` (with `!` inside the bold) → renders bold-red. Use sparingly: 1–2 per section max',
  '- Wrap **identifiers** (board card titles, dates like `2026-04-01`, status tags like `[high]` or `[todo]`) in backticks `` `...` `` → renders as a themed mono chip',
  '- Bullets where they help density; prose where it carries judgement',
  '- No preamble. Start directly with `## State`',
  '',
  'Worked example of the rhythm (do not copy the content, copy the rhythm):',
  '> `Gas Analysis [HG] [OC]` is marked **high** and due `2026-04-01` — that\'s **!two months overdue!** sitting on the live board. Either it\'s done and the card is lying, or it\'s quietly rotting under newer urgent work.',
].join('\n')

// Per-run payload — Dominion identity, date, and the live snapshot.
export function buildBriefUserPrompt(ctx: BriefingContext, today: string): string {
  const lines: string[] = [
    `Dominion: "${ctx.name}". Date: ${today}.`,
    '',
    '── INPUT ──',
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
      : ctx.objectives
          .map((o) => `- [${o.status}] ${o.title}${o.description ? ` — ${o.description}` : ''}`)
          .join('\n'),
    '',
    '## Projects',
    ctx.projects.length === 0 ? '(none)' : ctx.projects.map((p) => `- ${p.name}`).join('\n'),
    '',
    '## Recent memories',
    ctx.recentMemories.length === 0
      ? '(none)'
      : ctx.recentMemories
          .slice(0, 15)
          .map((m) => `- [${m.type}] ${m.title}${m.summary ? ` — ${m.summary}` : ''}`)
          .join('\n'),
    '',
    '## Open board cards (live)',
    ctx.boardTasks.length === 0
      ? '(none open)'
      : ctx.boardTasks
          .map((t) => {
            const due = t.endDate ? ` due ${new Date(t.endDate).toISOString().slice(0, 10)}` : ''
            return `- [${t.priority}/${t.status}] (${t.projectName}) ${t.name}${due}`
          })
          .join('\n'),
  ]
  return lines.join('\n')
}

// Combined single-string prompt (system + user). Kept for tests and any
// caller that doesn't split the request into cacheable blocks.
export function buildPrompt(ctx: BriefingContext, today: string): string {
  return [BRIEF_SYSTEM_PROMPT, buildBriefUserPrompt(ctx, today)].join('\n\n')
}
