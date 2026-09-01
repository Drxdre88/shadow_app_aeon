import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { loadCopilotTranscript } from './copilot-session-transcript.mjs'
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
    db.prepare('INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?)').run(
      1, 'session-1', 0, 'Wire the hook', '## Executive Summary\n\nCapture is wired.',
      '2026-09-01T08:01:00.000Z',
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
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('returns null when the Copilot session is absent', () => {
  assert.equal(loadCopilotTranscript('missing', join(tmpdir(), 'missing-copilot-store.db')), null)
})
