// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 — shared helpers for synthesis prompt builders.
//
// Hoisted here after the horsemen flagged byte-identical copies of
// neutraliseFences / extractJsonBlock / todayIso across archetypes-prompt,
// cortex-prompt, archetypes, cortex, and briefer. One copy means a future
// threat-model tightening (e.g. stripping XML fences too) updates exactly
// one place.
// ─────────────────────────────────────────────────────────────────────────

// Defense in depth against prompt-injection via memory titles/summaries:
// strip triple-backtick sequences so a hostile substrate row cannot close
// the JSON fence the model is asked to emit. Substrate is userId-scoped
// so the blast radius is self-harm only, but the cost of escaping is zero.
export function neutraliseFences(s: string): string {
  return s.replace(/```/g, "'''")
}

// Parse a model response that should contain ONE JSON object inside a
// ```json fenced block. Falls back to the first balanced {...} span when
// no fence is present. Throws a contextual error so the caller's runner
// can surface a useful `reason` field in its result.
export function extractJsonBlock(text: string, generatorLabel = 'kairos'): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${generatorLabel} generator: no JSON object found in response`)
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch (err) {
    throw new Error(`${generatorLabel} generator: malformed JSON — ${err instanceof Error ? err.message : String(err)}`)
  }
}

// UTC YYYY-MM-DD. Used as the day-bucket key for cron idempotency so the
// same UTC day looks identical across timezones.
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
