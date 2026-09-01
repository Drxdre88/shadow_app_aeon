import { readFileSync } from 'node:fs'
import { normalizeCodexHook } from './session-capture-dispatch.mjs'
import { enqueueAndDrain } from './session-capture-queue.mjs'

try {
  const raw = readFileSync(0, 'utf8')
  const payload = normalizeCodexHook(raw)
  if (!payload) process.exit(0)

  enqueueAndDrain({ ...payload, client: 'codex' })
} catch {
  process.exit(0)
}
