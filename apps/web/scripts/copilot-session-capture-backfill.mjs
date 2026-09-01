import {
  listCopilotBackfillSessions,
} from './copilot-session-transcript.mjs'
import { enqueueCapture, hasCaptureReceipt, startCaptureDrain } from './session-capture-queue.mjs'

const currentSessionId = process.argv[2]
if (typeof currentSessionId !== 'string') process.exit(0)

let attempted = 0

for (const session of listCopilotBackfillSessions(currentSessionId)) {
  if (hasCaptureReceipt('copilot', session.id)) continue

  const payload = {
    client: 'copilot',
    session_id: session.id,
    cwd: session.cwd,
    hook_event_name: 'SessionStartBackfill',
    reason: 'backfill',
  }
  enqueueCapture(payload)

  attempted++
  if (attempted >= 5) break
}
if (attempted > 0) startCaptureDrain()
