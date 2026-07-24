import { ZodError } from 'zod'
import type { AIProvider } from '@/lib/ai/provider'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 — shared helpers for synthesis prompt builders.
//
// Hoisted here after the horsemen flagged byte-identical copies of
// neutraliseFences / extractJsonBlock / todayIso across archetypes-prompt,
// cortex-prompt, archetypes, cortex, and briefer. One copy means a future
// threat-model tightening (e.g. stripping XML fences too) updates exactly
// one place.
//
// Synthesis reliability (docs/kairos/31, Part A) — buildRepairPrompt +
// parseWithRepair generalise the one-shot JSON-repair round-trip that
// aether.ts pioneered (aether.ts:305-357) so cortex/archetypes/
// introspection/contradiction all get the same retry instead of a bare
// parse/schema `.parse()` with zero recovery.
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

// Re-prompt payload for the ONE JSON-repair round-trip: sent as a user-turn
// message, never as a system-prompt change (the cached system prefix must
// stay byte-exact).
export function buildRepairPrompt(rawText: string, err: unknown, generatorLabel = 'kairos', context?: string): string {
  const message = err instanceof Error ? err.message : String(err)
  const parts = [
    `The previous ${generatorLabel} response failed JSON validation. Fix it and return ONLY the`,
    'corrected JSON in a single ```json fenced block — no prose before or after.',
    '',
    '## Validation error',
    message,
  ]
  // Context-dependent fields (e.g. citation ids) are unrepairable from the
  // broken JSON alone — the 2026-07-24 Shadow Apps trace showed repair copying
  // shortened ids into `citations` because it had no id list to consult.
  if (context) {
    parts.push('', '## Reference context', context)
  }
  parts.push('', '## Previous response', rawText)
  return parts.join('\n')
}

// Thrown by parseWithRepair when BOTH the original parse and the repair
// round-trip fail. Carries enough structure (kind, rawExcerpt) for callers
// to write a diagnosable failure trace without re-deriving it.
export class ParseRepairError extends Error {
  readonly kind: 'syntax' | 'schema'
  readonly rawExcerpt: string

  constructor(message: string, kind: 'syntax' | 'schema', rawExcerpt: string) {
    super(message)
    this.name = 'ParseRepairError'
    this.kind = kind
    this.rawExcerpt = rawExcerpt
  }
}

// Syntax failures (extractJsonBlock: no fence/braces, malformed JSON) vs
// schema failures (zod .parse() rejects a structurally-valid object) are
// different failure modes worth distinguishing in the trace.
function classifyParseError(err: unknown): 'syntax' | 'schema' {
  return err instanceof ZodError ? 'schema' : 'syntax'
}

export interface ParseWithRepairInput<T> {
  provider: Pick<AIProvider, 'ask'>
  rawText: string
  parse: (text: string) => T
  generatorLabel: string
  maxTokens?: number
  // Re-send the generator's own static system block on the repair call. Same
  // bytes as the original call, so the Anthropic prompt-cache prefix is reused
  // rather than broken. Without it the repair model sees only broken JSON + a
  // zod error and cannot recover context-dependent mistakes.
  system?: string
  // Extra grounding appended to the repair user-turn (e.g. the valid memory-id
  // list) so fields that reference the original context are actually fixable.
  repairContext?: string
}

// ONE JSON-repair round-trip: try the raw response as-is, and on parse/schema
// failure, re-prompt the SAME provider with the raw text + validation error
// as a plain user-turn message. If the repair also fails, throw a
// ParseRepairError carrying the original failure (the real diagnostic — a
// repair-call transport error would otherwise mask it) plus a bounded excerpt
// of the original raw output for retroactive debugging.
export async function parseWithRepair<T>(input: ParseWithRepairInput<T>): Promise<T> {
  const { provider, rawText, parse, generatorLabel, maxTokens = 4000, system, repairContext } = input
  try {
    return parse(rawText)
  } catch (firstErr) {
    try {
      const repairResponse = await provider.ask({
        prompt: buildRepairPrompt(rawText, firstErr, generatorLabel, repairContext),
        maxTokens,
        ...(system ? { system, cacheSystem: true } : {}),
      })
      return parse(repairResponse.text.trim())
    } catch (repairErr) {
      const firstMessage = firstErr instanceof Error ? firstErr.message : String(firstErr)
      const repairMessage = repairErr instanceof Error ? repairErr.message : String(repairErr)
      throw new ParseRepairError(
        `parse_failed: ${firstMessage} (repair also failed: ${repairMessage})`,
        classifyParseError(firstErr),
        rawText.slice(0, 500),
      )
    }
  }
}
