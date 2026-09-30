import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeCopilotHook } from './session-capture-dispatch.mjs'
import { enqueueAndDrain } from './session-capture-queue.mjs'

// Loaded dynamically so a broken enrichment module can never cost the capture.
const withDispatchContext = await import('./session-record.mjs')
  .then((m) => m.withDispatchContext)
  .catch(() => (payload) => payload)

try {
  const raw = readFileSync(0, 'utf8')
  const payload = normalizeCopilotHook(raw)
  if (!payload) process.exit(0)
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  if (payload.hook_event_name === 'SessionStart') {
    const backfillScript = join(scriptDir, 'copilot-session-capture-backfill.mjs')
    const child = spawn(process.execPath, [backfillScript, payload.session_id], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => {})
    child.unref()
    process.exit(0)
  }

  enqueueAndDrain(withDispatchContext(payload))
} catch {
  process.exit(0)
}
