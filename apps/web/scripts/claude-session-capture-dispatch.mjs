import { readFileSync } from 'node:fs'
import { enqueueAndDrain } from './session-capture-queue.mjs'

try {
  const payload = JSON.parse(readFileSync(0, 'utf8'))
  if (typeof payload?.session_id === 'string' && typeof payload?.transcript_path === 'string') {
    enqueueAndDrain({ ...payload, client: 'claude' })
  }
} catch {
  process.exit(0)
}
