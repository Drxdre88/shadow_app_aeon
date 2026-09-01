import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hasCopilotCaptureReceipt,
  listCopilotBackfillSessions,
} from './copilot-session-transcript.mjs'

const currentSessionId = process.argv[2]
if (typeof currentSessionId !== 'string') process.exit(0)

const scriptDir = dirname(fileURLToPath(import.meta.url))
const captureScript = join(scriptDir, 'claude-session-capture.mjs')
let attempted = 0

for (const session of listCopilotBackfillSessions(currentSessionId)) {
  if (hasCopilotCaptureReceipt(session.id)) continue

  const payload = {
    client: 'copilot',
    session_id: session.id,
    cwd: session.cwd,
    hook_event_name: 'SessionStartBackfill',
    reason: 'backfill',
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  spawnSync(process.execPath, [captureScript, '--hook-payload-base64', encodedPayload], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 30_000,
  })

  attempted++
  if (attempted >= 5) break
}
