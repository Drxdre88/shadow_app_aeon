import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeCodexHook, normalizeCodexStartHook } from './session-capture-dispatch.mjs'
import { enqueueAndDrain } from './session-capture-queue.mjs'

try {
  const raw = readFileSync(0, 'utf8')

  const endPayload = normalizeCodexHook(raw)
  if (endPayload) {
    enqueueAndDrain({ ...endPayload, client: 'codex' })
    process.exit(0)
  }

  // No transcript_path — this is SessionStart. Rescue whatever the last
  // session's end hook failed to capture, detached so the hook returns
  // immediately and never delays the session starting.
  const startPayload = normalizeCodexStartHook(raw)
  if (!startPayload) process.exit(0)

  const backfillScript = join(dirname(fileURLToPath(import.meta.url)), 'codex-session-capture-backfill.mjs')
  const args = [backfillScript]
  if (startPayload.session_id) args.push(startPayload.session_id)

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('error', () => {})
  child.unref()
} catch {
  process.exit(0)
}
