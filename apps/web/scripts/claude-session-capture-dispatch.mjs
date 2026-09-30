import { readFileSync } from 'node:fs'
import { enqueueAndDrain } from './session-capture-queue.mjs'

// Loaded dynamically so a broken enrichment module can never cost the capture:
// the job then queues exactly as it did before (the drain handles both shapes).
const withDispatchContext = await import('./session-record.mjs')
  .then((m) => m.withDispatchContext)
  .catch(() => (payload) => payload)

try {
  const payload = JSON.parse(readFileSync(0, 'utf8'))
  if (typeof payload?.session_id === 'string' && typeof payload?.transcript_path === 'string') {
    enqueueAndDrain(withDispatchContext({ ...payload, client: 'claude' }))
  }
} catch {
  process.exit(0)
}
