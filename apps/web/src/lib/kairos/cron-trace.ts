import { captureMemory } from '@/lib/data/memories'

// ─────────────────────────────────────────────────────────────────────────
// Kairos reliability (C1) — durable failure traces for the nightly crons.
//
// All Kairos crons return HTTP 200 even when a run fails internally (the
// route always resolves, per-user/per-Dominion errors are caught and
// reported in the JSON body only) — Vercel's cron monitor never sees a
// failure, so a broken generator can go dark for days before anyone notices
// (root cause of the 6-day Aether outage). This writes a streamClass:'trace'
// memory so failures are queryable/visible even though the HTTP layer stays
// green.
//
// Call this ONLY from real failures (empty model response, parse/schema
// failure, nothing grounded to persist, insert-returned-nothing, uncaught
// exceptions). Do NOT call it for benign no-ops — already ran today, no
// signal to synthesise, no BYOK credential, an undecryptable key, or an
// archived Dominion are all expected skips, not failures.
// ─────────────────────────────────────────────────────────────────────────

export interface CronFailureTraceInput {
  cronName: string
  dominionId?: string | null
  reason: string
  error?: unknown
  durationMs?: number
  // Synthesis reliability (docs/kairos/31, A6) — the model's own finishReason
  // ('length' etc.) makes truncation distinguishable from malformed content.
  finishReason?: string
  // Bounded (≤500 char) excerpt of the raw model output that failed to
  // parse, so failure sub-modes are diagnosable retroactively.
  rawExcerpt?: string
}

export async function writeCronFailureTrace(userId: string, input: CronFailureTraceInput): Promise<void> {
  const { cronName, dominionId = null, reason, error, durationMs, finishReason, rawExcerpt } = input
  const errorMessage = error instanceof Error ? error.message : error !== undefined ? String(error) : undefined

  const body: Record<string, unknown> = { cronName, reason }
  if (durationMs !== undefined) body.durationMs = durationMs
  if (errorMessage !== undefined) body.error = errorMessage
  if (error instanceof Error && error.stack) body.stack = error.stack
  if (finishReason !== undefined) body.finishReason = finishReason
  if (rawExcerpt !== undefined) body.rawExcerpt = rawExcerpt

  try {
    await captureMemory(userId, {
      type: 'session_event',
      streamClass: 'trace',
      source: 'system',
      title: `${cronName} failed · ${reason}`,
      bodyMd: JSON.stringify(body, null, 2),
      dominionId,
      sourceMetadata: body,
    })
  } catch (traceErr) {
    // The trace write is best-effort audit visibility, not correctness —
    // never let a broken trace write mask or replace the original failure.
    console.error(`[kairos:cron-trace] failed to write failure trace for ${cronName}:`, traceErr)
  }
}
