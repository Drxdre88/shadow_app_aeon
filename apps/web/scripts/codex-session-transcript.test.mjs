import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseCodexRolloutSessionId,
  readCodexSessionCwd,
  listCodexBackfillSessions,
} from './codex-session-transcript.mjs'

const SID_A = '01a05bc1-8469-7fa2-9ea0-3fdd61f6b43f'
const SID_B = '01a05bbb-cb36-7160-b448-a162e55d0c08'
const SID_C = '01a05bab-8078-7110-bd4f-d62786e9a93b'

function rollout(sessionId, stamp = '2026-09-01T07-56-44') {
  return `rollout-${stamp}-${sessionId}.jsonl`
}

function seed(root, { sessionId, stamp, cwd = 'C:\\repo', mtime, body = null }) {
  const dir = join(root, '2026', '09', '01')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, rollout(sessionId, stamp))
  const meta = JSON.stringify({ type: 'session_meta', payload: { session_id: sessionId, cwd } })
  writeFileSync(path, body ?? `${meta}\n`, 'utf8')
  if (mtime !== undefined) utimesSync(path, mtime / 1000, mtime / 1000)
  return path
}

test('parses the session id out of a rollout filename, and only a rollout filename', () => {
  assert.equal(parseCodexRolloutSessionId(rollout(SID_A)), SID_A)
  // The timestamp uses '-' internally too — the id must be the trailing group.
  assert.equal(parseCodexRolloutSessionId(rollout(SID_B, '2026-12-31T23-59-59')), SID_B)

  assert.equal(parseCodexRolloutSessionId('rollout-2026-09-01T07-56-44-short.jsonl'), null)
  assert.equal(parseCodexRolloutSessionId(`${SID_A}.jsonl`), null)
  assert.equal(parseCodexRolloutSessionId(rollout(SID_A).replace('.jsonl', '.json')), null)
  assert.equal(parseCodexRolloutSessionId('history.jsonl'), null)
  assert.equal(parseCodexRolloutSessionId(undefined), null)
})

test('reads cwd from session_meta, and never throws on a bad rollout', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-cwd-'))
  const good = seed(root, { sessionId: SID_A, cwd: 'C:\\Users\\me\\repo' })
  assert.equal(readCodexSessionCwd(good), 'C:\\Users\\me\\repo')

  // A first record with no trailing newline is treated as unknown rather than
  // parsed from a possibly-truncated line.
  const unterminated = seed(root, { sessionId: SID_B, body: '{"type":"session_meta","payload":{"cwd":"x"}}' })
  assert.equal(readCodexSessionCwd(unterminated), null)

  const malformed = seed(root, { sessionId: SID_C, body: 'not json\n' })
  assert.equal(readCodexSessionCwd(malformed), null)

  assert.equal(readCodexSessionCwd(join(root, 'missing.jsonl')), null)
})

test('lists rollouts newest-first, excluding the current session', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-list-'))
  const now = Date.now()

  seed(root, { sessionId: SID_A, mtime: now - 60_000 })
  seed(root, { sessionId: SID_B, stamp: '2026-09-01T06-00-00', mtime: now - 3_600_000 })
  seed(root, { sessionId: SID_C, stamp: '2026-09-01T05-00-00', mtime: now - 7_200_000 })

  const all = listCodexBackfillSessions(null, { root, now })
  assert.deepEqual(all.map((s) => s.id), [SID_A, SID_B, SID_C])

  const excluded = listCodexBackfillSessions(SID_A, { root, now })
  assert.deepEqual(excluded.map((s) => s.id), [SID_B, SID_C])
})

test('honours the time window, the scan limit, and skips empty rollouts', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-window-'))
  const now = Date.now()

  seed(root, { sessionId: SID_A, mtime: now - 60_000 })
  // Older than the 48h default window.
  seed(root, { sessionId: SID_B, stamp: '2026-08-01T06-00-00', mtime: now - 100 * 3_600_000 })

  assert.deepEqual(listCodexBackfillSessions(null, { root, now }).map((s) => s.id), [SID_A])
  assert.equal(listCodexBackfillSessions(null, { root, now, hoursWindow: 200 }).length, 2)
  assert.equal(listCodexBackfillSessions(null, { root, now, scanLimit: 1 }).length, 1)

  // A zero-byte rollout carries nothing to capture and must not burn a receipt.
  const empty = mkdtempSync(join(tmpdir(), 'codex-empty-'))
  seed(empty, { sessionId: SID_C, mtime: now - 60_000, body: '' })
  assert.deepEqual(listCodexBackfillSessions(null, { root: empty, now }), [])
})

test('a missing sessions root yields nothing rather than throwing', () => {
  assert.deepEqual(listCodexBackfillSessions(null, { root: join(tmpdir(), 'codex-does-not-exist-xyz') }), [])
})
