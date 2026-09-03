import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_HOOK_PAYLOAD_BYTES,
  encodeHookPayload,
  normalizeCodexHook,
  normalizeCodexStartHook,
  normalizeCopilotHook,
} from './session-capture-dispatch.mjs'

test('normalizes a Codex hook and rejects unsafe inputs', () => {
  const payload = { transcript_path: 'C:/sessions/one.jsonl', session_id: 'one' }
  assert.deepEqual(normalizeCodexHook(JSON.stringify(payload)), payload)
  assert.equal(normalizeCodexHook(''), null)
  assert.equal(normalizeCodexHook('{'), null)
  assert.equal(normalizeCodexHook(JSON.stringify({ session_id: 'one' })), null)
  assert.equal(normalizeCodexHook(JSON.stringify({ transcript_path: 'x'.repeat(MAX_HOOK_PAYLOAD_BYTES) })), null)
})

test('normalizes both Copilot SessionEnd payload shapes', () => {
  assert.deepEqual(normalizeCopilotHook(JSON.stringify({
    sessionId: 'camel-session',
    cwd: 'C:/repo',
    reason: 'complete',
  })), {
    client: 'copilot',
    session_id: 'camel-session',
    cwd: 'C:/repo',
    hook_event_name: 'SessionEnd',
    reason: 'complete',
  })
  assert.deepEqual(normalizeCopilotHook(JSON.stringify({
    hook_event_name: 'SessionEnd',
    session_id: 'pascal-session',
  })), {
    client: 'copilot',
    session_id: 'pascal-session',
    cwd: null,
    hook_event_name: 'SessionEnd',
    reason: null,
  })
})

test('normalizes Copilot SessionStart and malformed payloads', () => {
  for (const source of ['startup', 'resume', 'new']) {
    assert.deepEqual(normalizeCopilotHook(JSON.stringify({ sessionId: 'one', source })), {
      client: 'copilot',
      session_id: 'one',
      cwd: null,
      hook_event_name: 'SessionStart',
      reason: null,
    })
  }
  for (const eventName of ['SessionStart', 'sessionStart']) {
    assert.deepEqual(normalizeCopilotHook(JSON.stringify({ hook_event_name: eventName, session_id: 'one' })), {
      client: 'copilot',
      session_id: 'one',
      cwd: null,
      hook_event_name: 'SessionStart',
      reason: null,
    })
  }
  assert.equal(normalizeCopilotHook(JSON.stringify({ reason: 'complete' })), null)
  assert.equal(normalizeCopilotHook('not-json'), null)
})

test('base64 encoding round-trips normalized payloads', () => {
  const payload = { client: 'copilot', session_id: 'one', cwd: 'C:/repo' }
  const decoded = Buffer.from(encodeHookPayload(payload), 'base64').toString('utf8')
  assert.deepEqual(JSON.parse(decoded), payload)
})

test('normalizes a Codex SessionStart payload, and never claims an end payload', () => {
  assert.deepEqual(normalizeCodexStartHook(JSON.stringify({ session_id: 'abc', cwd: 'C:\repo' })), {
    client: 'codex',
    session_id: 'abc',
    cwd: 'C:\repo',
    hook_event_name: 'SessionStart',
  })

  // camelCase variant
  assert.equal(normalizeCodexStartHook(JSON.stringify({ sessionId: 'abc' })).session_id, 'abc')

  // A session id we cannot read is tolerated — receipts keep backfill safe.
  assert.deepEqual(normalizeCodexStartHook(JSON.stringify({ cwd: 'C:\repo' })), {
    client: 'codex',
    session_id: null,
    cwd: 'C:\repo',
    hook_event_name: 'SessionStart',
  })

  // The two normalizers must never both accept the same fire.
  const endPayload = JSON.stringify({ session_id: 'abc', transcript_path: '/x.jsonl' })
  assert.notEqual(normalizeCodexHook(endPayload), null)
  assert.equal(normalizeCodexStartHook(endPayload), null)

  assert.equal(normalizeCodexStartHook('not-json'), null)
  assert.equal(normalizeCodexStartHook(''), null)
})
