import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'aeon-capture-queue-'))
process.env.AEON_CAPTURE_HOME = root
process.env.CODEX_HOME = join(root, 'codex-home')
const queue = await import('./session-capture-queue.mjs')

test.after(() => rmSync(root, { recursive: true, force: true }))

test('duplicate hook exits converge on one durable job', () => {
  const payload = { client: 'codex', session_id: 'burst-session', transcript_path: 'C:/one.jsonl' }
  const paths = Array.from({ length: 4 }, () => queue.enqueueCapture(payload))
  assert.equal(new Set(paths).size, 1)
  const job = JSON.parse(readFileSync(paths[0], 'utf8'))
  assert.equal(job.client, 'codex')
  assert.equal(job.sessionId, 'burst-session')
  assert.equal(job.attempts, 0)
})

test('a success receipt makes repeat enqueue a no-op', () => {
  assert.equal(queue.recordCaptureReceipt('codex', 'captured-session', 'memory-1'), true)
  assert.equal(queue.recordCaptureReceipt('codex', 'captured-session', 'memory-2'), true)
  assert.equal(readFileSync(queue.captureReceiptPath('codex', 'captured-session'), 'utf8'), 'memory-1')
  assert.equal(queue.enqueueCapture({ client: 'codex', session_id: 'captured-session' }), null)
})

test('rejects unsafe queue identities', () => {
  assert.equal(queue.enqueueCapture({ client: 'other', session_id: 'one' }), null)
  assert.equal(queue.enqueueCapture({ client: 'codex', session_id: '../one' }), null)
})
