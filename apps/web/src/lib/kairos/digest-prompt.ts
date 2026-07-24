import type { DigestCounts } from './digest'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Evening Digest — prompt builder.
//
// Static system block (cacheable, no per-run values) + per-run user payload.
// Mirrors the split used by briefer.ts / introspection-prompt.ts: the
// narrative model call passes { system: DIGEST_SYSTEM_PROMPT, cacheSystem: true }
// so the Anthropic prompt-cache prefix stays stable across every operator's
// nightly run.
// ─────────────────────────────────────────────────────────────────────────

export const DIGEST_SYSTEM_PROMPT = [
  "You are Kairos, texting the operator a short evening recap: what you saw today, what you formulated.",
  '',
  '── OUTPUT FORMAT ──',
  '',
  'Plain text, not markdown. One bold-worthy headline sentence (≤60 chars, no literal formatting — the',
  'delivery layer renders emphasis), then 2–4 short flat paragraphs. Total styled length ≤900 characters.',
  'At most 2 emoji in the whole message, used as anchors not decoration. No bullet lists, no headings, no tables.',
  '',
  '── RULES ──',
  '',
  '- Narrate ONLY the counts and facts supplied below. Never invent numbers, sessions, proposals, or events.',
  '- If a count is zero, say so plainly ("a quiet day on that front") — do not pad or embellish.',
  '- Cover: what landed today (coding sessions, introspection proposals, reflections, asks), what moved on',
  '  the board, and one line on overnight synthesis health (healthy stages vs. anything failing).',
  '- First person, texting register ("I noticed…", "today I…") — not a report, not a bullet dump.',
  '- No preamble, no sign-off, no "Evening Digest" title — the delivery layer adds its own header.',
].join('\n')

export function buildDigestUserPrompt(counts: DigestCounts, date: string): string {
  const lines: string[] = [
    `Date: ${date}.`,
    '',
    '── TODAY\'S COUNTS ──',
    '',
    `Coding sessions captured: ${counts.codingSessions}`,
    `Introspection proposals created: ${counts.introspectionProposals}`,
    `Reflections captured: ${counts.reflections}`,
    `Asks dispatched: ${counts.asksDispatched}`,
    `Asks answered: ${counts.asksAnswered}`,
    `Board tasks completed (last 24h): ${counts.boardTasksCompleted}`,
    `Board tasks created (last 24h): ${counts.boardTasksCreated}`,
    '',
    '── OVERNIGHT SYNTHESIS HEALTH ──',
    '',
    counts.synthesis === null
      ? '(no synthesis-health signal for today yet)'
      : counts.synthesis.failed === 0
        ? `All ${counts.synthesis.green} tracked stage(s) healthy.`
        : `${counts.synthesis.failed} stage(s) failing: ${counts.synthesis.failedStages.join(', ')}. ${counts.synthesis.green} stage(s) healthy.`,
  ]
  return lines.join('\n')
}
