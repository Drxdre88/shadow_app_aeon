import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeHookPayload, normalizeCopilotHook } from './session-capture-dispatch.mjs'

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

  const captureScript = join(scriptDir, 'claude-session-capture.mjs')
  const encodedPayload = encodeHookPayload(payload)
  const child = spawn(process.execPath, [captureScript, '--hook-payload-base64', encodedPayload], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('error', () => {})
  child.unref()
} catch {
  process.exit(0)
}
