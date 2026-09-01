import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function resolveCopilotStorePath() {
  const copilotHome = process.env.COPILOT_HOME || join(homedir(), '.copilot')
  return process.env.COPILOT_SESSION_STORE || join(copilotHome, 'session-store.db')
}

function validSessionId(sessionId) {
  return typeof sessionId === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(sessionId)
}

export function copilotCaptureReceiptPath(sessionId) {
  if (!validSessionId(sessionId)) return null
  const copilotHome = process.env.COPILOT_HOME || join(homedir(), '.copilot')
  return join(copilotHome, 'aeon-capture-receipts', sessionId)
}

export function hasCopilotCaptureReceipt(sessionId) {
  const receiptPath = copilotCaptureReceiptPath(sessionId)
  if (!receiptPath) return false
  try {
    return statSync(receiptPath).size > 0
  } catch {
    return false
  }
}

export function recordCopilotCaptureReceipt(sessionId, memoryId) {
  const receiptPath = copilotCaptureReceiptPath(sessionId)
  if (!receiptPath || typeof memoryId !== 'string' || !memoryId) return false
  try {
    mkdirSync(dirname(receiptPath), { recursive: true })
    writeFileSync(receiptPath, memoryId, 'utf8')
    return true
  } catch {
    return false
  }
}

export function listCopilotBackfillSessions(currentSessionId, limit = 100, storePath = resolveCopilotStorePath()) {
  if (!validSessionId(currentSessionId) || !existsSync(storePath)) return []
  const boundedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 100
  const db = new DatabaseSync(storePath, { readOnly: true })
  try {
    const sessions = db.prepare(`
      SELECT s.id, s.cwd
      FROM sessions s
      WHERE s.id <> ?
        AND EXISTS (
          SELECT 1
          FROM turns t
          WHERE t.session_id = s.id
            AND trim(coalesce(t.assistant_response, '')) <> ''
        )
      ORDER BY s.updated_at DESC
      LIMIT ?
    `).all(currentSessionId, boundedLimit)
    return sessions.map((session) => ({ id: session.id, cwd: session.cwd }))
  } finally {
    db.close()
  }
}

export function loadCopilotTranscript(sessionId, storePath = resolveCopilotStorePath()) {
  if (!validSessionId(sessionId)) return null
  if (!existsSync(storePath)) return null

  const db = new DatabaseSync(storePath, { readOnly: true })
  try {
    const session = db.prepare(`
      SELECT cwd, created_at
      FROM sessions
      WHERE id = ?
    `).get(sessionId)
    if (!session) return null

    const turns = db.prepare(`
      SELECT turn_index, user_message, assistant_response, timestamp
      FROM turns
      WHERE session_id = ?
      ORDER BY turn_index
    `).all(sessionId)
    const files = db.prepare(`
      SELECT file_path, first_seen_at
      FROM session_files
      WHERE session_id = ?
      ORDER BY first_seen_at, file_path
    `).all(sessionId)

    const messages = []
    for (const turn of turns) {
      if (typeof turn.user_message === 'string' && turn.user_message.trim()) {
        messages.push({
          type: 'user',
          message: { content: turn.user_message },
          timestamp: turn.timestamp,
          cwd: session.cwd,
        })
      }
      if (typeof turn.assistant_response === 'string' && turn.assistant_response.trim()) {
        messages.push({
          type: 'assistant',
          message: { content: turn.assistant_response },
          timestamp: turn.timestamp,
          cwd: session.cwd,
        })
      }
    }
    for (const file of files) {
      if (typeof file.file_path !== 'string' || !file.file_path) continue
      messages.push({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file.file_path } }],
        },
        timestamp: file.first_seen_at,
        cwd: session.cwd,
      })
    }

    return [{
      type: 'session_meta',
      timestamp: session.created_at,
      payload: {
        client: 'copilot',
        cwd: session.cwd,
      },
    }, ...messages]
  } finally {
    db.close()
  }
}
