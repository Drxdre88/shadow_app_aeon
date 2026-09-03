// Recover Codex sessions the SessionEnd hook never captured.
//
// Spawned detached from the SessionStart hook, exactly like the Copilot
// backfill: the next session you start is what rescues the last one that died.
// Receipts make it idempotent, so a session already captured is skipped and a
// re-run costs nothing.

import { listCodexBackfillSessions, readCodexSessionCwd } from './codex-session-transcript.mjs'
import { enqueueCapture, hasCaptureReceipt, startCaptureDrain } from './session-capture-queue.mjs'

// Matches the Copilot backfill's cap. A start hook must stay cheap — this is
// a recovery trickle, not a bulk import, and the next session picks up the
// rest. Raise deliberately via the env var for a one-off catch-up.
const MAX_PER_RUN = Number.parseInt(process.env.BRAIN_CODEX_BACKFILL_MAX ?? '5', 10) || 5

// argv[2] is absent when the start hook could not tell us its own session id.
// Excluding nothing is safe: the current session's rollout is either missing
// or empty this early, and both are filtered out before enqueue.
const currentSessionId = typeof process.argv[2] === 'string' ? process.argv[2] : null

let queued = 0

for (const session of listCodexBackfillSessions(currentSessionId)) {
  if (hasCaptureReceipt('codex', session.id)) continue

  enqueueCapture({
    client: 'codex',
    session_id: session.id,
    transcript_path: session.path,
    cwd: readCodexSessionCwd(session.path),
    hook_event_name: 'SessionStartBackfill',
    reason: 'backfill',
  })

  queued++
  if (queued >= MAX_PER_RUN) break
}

if (queued > 0) startCaptureDrain()
