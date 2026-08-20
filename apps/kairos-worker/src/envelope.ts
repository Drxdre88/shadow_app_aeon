// Terminal result envelope recovery. The engine's last fenced json block is the
// mission's verdict, but it arrives buried in a stream-json transcript and the
// enum is routinely improvised, so extraction and canonicalization live here —
// away from the poll loop and unit-testable on their own.

export const CANONICAL_STATUSES = new Set(['completed', 'needs_input', 'failed'])

// Engines that can't discover the objective skills (no junctions yet) improvise
// envelope enums — 'complete' for 'completed' cost the first Copilot mission its
// result. Normalize the common aliases; Aeon's schema stays strict.
//
// Null prototype so a status of '__proto__' or 'constructor' can't reach an
// inherited member and masquerade as an alias.
export const STATUS_ALIASES: Record<string, string | undefined> = Object.assign(Object.create(null), {
  complete: 'completed', done: 'completed', success: 'completed', succeeded: 'completed',
  failure: 'failed', error: 'failed',
})

export function normalizeEnvelope(
  envelope: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!envelope || typeof envelope.status !== 'string') return envelope
  const key = envelope.status.toLowerCase().trim()
  const canonical = STATUS_ALIASES[key] ?? key
  if (!CANONICAL_STATUSES.has(canonical)) return envelope
  return canonical === envelope.status ? envelope : { ...envelope, status: canonical }
}

// wasKilled wins over everything; an envelope Aeon refused is a failure however
// green it claims to be, because the board has no result to show for it.
export function decideFinalStatus(
  reportedStatus: string | null,
  killed: boolean,
  envelopeRejected: boolean,
): 'killed' | 'succeeded' | 'failed' {
  if (killed) return 'killed'
  if (envelopeRejected) return 'failed'
  return reportedStatus === 'completed' || reportedStatus === 'needs_input' ? 'succeeded' : 'failed'
}

export function tryParse(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text.trim())
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

// stream-json / --output-format json wrap the agent's prose in JSON, so the
// fenced block arrives escaped. Append the decoded text after the raw stream
// and scan both — decoded wins because it is searched last-first.
export function collectText(raw: string): string {
  const decoded: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    const parsed = tryParse(trimmed)
    if (parsed) decoded.push(...textFragments(parsed, 0))
  }
  return decoded.length ? `${raw}\n${decoded.join('\n')}` : raw
}

function textFragments(value: unknown, depth: number): string[] {
  if (depth > 6 || !value || typeof value !== 'object') return []
  const out: string[] = []
  if (Array.isArray(value)) {
    for (const item of value) out.push(...textFragments(item, depth + 1))
    return out
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      if (key === 'text' || key === 'result' || key === 'content') out.push(item)
    } else if (item && typeof item === 'object') {
      out.push(...textFragments(item, depth + 1))
    }
  }
  return out
}

// The dispatch prompt shows the engine a fenced json TEMPLATE whose status reads
// "completed|needs_input|failed" — valid JSON, so a naive last-block scan hands
// back the template whenever the engine echoes the instructions after its real
// answer. Only a block that normalizes to a canonical status may win outright.
function looksLikeEnvelope(value: Record<string, unknown>): boolean {
  const status = value.status
  if (typeof status !== 'string' || status.includes('|')) return false
  const normalized = normalizeEnvelope(value)
  return typeof normalized?.status === 'string' && CANONICAL_STATUSES.has(normalized.status)
}

export function extractEnvelope(text: string): Record<string, unknown> | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)]
  let fallback: Record<string, unknown> | null = null
  for (let i = blocks.length - 1; i >= 0; i--) {
    const parsed = tryParse(blocks[i][1])
    if (!parsed) continue
    if (looksLikeEnvelope(parsed)) return parsed
    fallback ??= parsed
  }
  return fallback
}
