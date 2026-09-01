import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  copilotCaptureReceiptPath,
  hasCopilotCaptureReceipt,
  listCopilotBackfillSessions,
  loadCopilotTranscript,
  loadCopilotTranscriptWhenReady,
  recordCopilotCaptureReceipt,
} from './copilot-session-transcript.mjs'
import { normalizeTranscript } from './session-transcript.mjs'

test('loads and normalizes a Copilot session from SQLite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-copilot-capture-'))
  const storePath = join(dir, 'session-store.db')
  const db = new DatabaseSync(storePath)
  try {
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        cwd TEXT,
        repository TEXT,
        branch TEXT,
        summary TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE turns (
        id INTEGER PRIMARY KEY,
        session_id TEXT,
        turn_index INTEGER,
        user_message TEXT,
        assistant_response TEXT,
        timestamp TEXT
      );
      CREATE TABLE session_files (
        id INTEGER PRIMARY KEY,
        session_id TEXT,
        file_path TEXT,
        tool_name TEXT,
        turn_index INTEGER,
        first_seen_at TEXT
      );
    `)
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'session-1', 'C:/repo', 'owner/repo', 'feat/capture', null,
      '2026-09-01T08:00:00.000Z', '2026-09-01T08:05:00.000Z',
    )
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'current-session', 'C:/current', null, null, null,
      '2026-09-01T08:06:00.000Z', '2026-09-01T08:07:00.000Z',
    )
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'user-only-session', 'C:/incomplete', null, null, null,
      '2026-09-01T08:08:00.000Z', '2026-09-01T08:09:00.000Z',
    )
    db.prepare('INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?)').run(
      1, 'session-1', 0, 'Wire the hook', '## Executive Summary\n\nCapture is wired.',
      '2026-09-01T08:01:00.000Z',
    )
    db.prepare('INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?)').run(
      2, 'current-session', 0, 'Current prompt', 'Current response',
      '2026-09-01T08:06:00.000Z',
    )
    db.prepare('INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?)').run(
      3, 'user-only-session', 0, 'No response yet', null,
      '2026-09-01T08:08:00.000Z',
    )
    db.prepare('INSERT INTO session_files VALUES (?, ?, ?, ?, ?, ?)').run(
      1, 'session-1', 'src/capture.ts', 'edit', 0, '2026-09-01T08:02:00.000Z',
    )
  } finally {
    db.close()
  }

  try {
    const records = loadCopilotTranscript('session-1', storePath)
    const result = normalizeTranscript(records)

    assert.equal(result.client, 'copilot')
    assert.deepEqual(result.messages.map((message) => message.type), ['user', 'assistant', 'assistant'])
    assert.equal(result.messages[0].message.content, 'Wire the hook')
    assert.equal(result.messages[1].message.content, '## Executive Summary\n\nCapture is wired.')
    assert.equal(result.messages[2].message.content[0].input.file_path, 'src/capture.ts')
    assert.deepEqual(listCopilotBackfillSessions('current-session', 5, storePath), [
      { id: 'session-1', cwd: 'C:/repo' },
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('returns null when the Copilot session is absent', () => {
  assert.equal(loadCopilotTranscript('missing', join(tmpdir(), 'missing-copilot-store.db')), null)
})

test('retries until the Copilot user and assistant turn is durable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-copilot-race-'))
  const storePath = join(dir, 'session-store.db')
  const db = new DatabaseSync(storePath)
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, created_at TEXT);
    CREATE TABLE turns (
      id INTEGER PRIMARY KEY,
      session_id TEXT,
      turn_index INTEGER,
      user_message TEXT,
      assistant_response TEXT,
      timestamp TEXT
    );
    CREATE TABLE session_files (
      id INTEGER PRIMARY KEY,
      session_id TEXT,
      file_path TEXT,
      first_seen_at TEXT
    );
  `)
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(
    'delayed-session', 'C:/repo', '2026-09-01T08:00:00.000Z',
  )
  db.close()

  const commit = setTimeout(() => {
    const writer = new DatabaseSync(storePath)
    writer.prepare('INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?)').run(
      1, 'delayed-session', 0, 'Durable user turn', 'Durable assistant turn',
      '2026-09-01T08:00:01.000Z',
    )
    writer.close()
  }, 30)

  try {
    const records = await loadCopilotTranscriptWhenReady(
      'delayed-session', storePath, { maxRetries: 8, delayMs: 20 },
    )
    assert.deepEqual(records.map((record) => record.type), ['session_meta', 'user', 'assistant'])
  } finally {
    clearTimeout(commit)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('bounds Copilot transcript retries when the final turn never arrives', { timeout: 1_000 }, async () => {
  const records = await loadCopilotTranscriptWhenReady(
    'missing', join(tmpdir(), 'missing-copilot-store.db'), { maxRetries: 2, delayMs: 5 },
  )
  assert.equal(records, null)
})

test('records successful Copilot captures in a validated receipt path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-copilot-receipt-'))
  const priorHome = process.env.COPILOT_HOME
  process.env.COPILOT_HOME = dir
  try {
    assert.equal(hasCopilotCaptureReceipt('session-2'), false)
    assert.equal(recordCopilotCaptureReceipt('session-2', 'memory-2'), true)
    assert.equal(hasCopilotCaptureReceipt('session-2'), true)
    assert.equal(copilotCaptureReceiptPath('../escape'), null)
    assert.equal(recordCopilotCaptureReceipt('../escape', 'memory-3'), false)
  } finally {
    if (priorHome === undefined) delete process.env.COPILOT_HOME
    else process.env.COPILOT_HOME = priorHome
    rmSync(dir, { recursive: true, force: true })
  }
})
