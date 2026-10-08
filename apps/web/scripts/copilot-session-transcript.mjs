import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { captureReceiptPath, hasCaptureReceipt, recordCaptureReceipt } from './session-capture-queue.mjs'

export function resolveCopilotStorePath() {
  const copilotHome = process.env.COPILOT_HOME || join(homedir(), '.copilot')
  return process.env.COPILOT_SESSION_STORE || join(copilotHome, 'session-store.db')
}

// A just-ended session can still be writing its final turn, so an empty read is
// worth retrying only while its session-state is fresh. A missing or stale
// folder (a wiped harness home, a probe that never had a conversation) will
// never produce a transcript, and retrying only dead-letters it.
const FRESH_MS = 15 * 60_000

export function copilotSessionMayStillWrite(
  sessionId,
  copilotHome = process.env.COPILOT_HOME || join(homedir(), '.copilot'),
  now = Date.now(),
) {
  if (!validSessionId(sessionId)) return false
  const dir = join(copilotHome, 'session-state', sessionId)
  if (!existsSync(dir)) return false
  const events = join(dir, 'events.jsonl')
  const lastWrite = Math.max(statSync(dir).mtimeMs, existsSync(events) ? statSync(events).mtimeMs : 0)
  return now - lastWrite < FRESH_MS
}

function validSessionId(sessionId) {
  return typeof sessionId === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(sessionId)
}

export function copilotCaptureReceiptPath(sessionId) {
  return captureReceiptPath('copilot', sessionId)
}

export function hasCopilotCaptureReceipt(sessionId) {
  return hasCaptureReceipt('copilot', sessionId)
}

export function recordCopilotCaptureReceipt(sessionId, memoryId) {
  return recordCaptureReceipt('copilot', sessionId, memoryId)
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

// Model + token totals from assistant_usage_events. Older stores have no such
// table — telemetry is optional, so any failure yields null, never an error.
export function readCopilotUsage(db, sessionId) {
  try {
    const rows = db.prepare(`
      SELECT model,
             count(*) AS calls,
             sum(coalesce(input_tokens, 0)) AS input_tokens,
             sum(coalesce(output_tokens, 0)) AS output_tokens,
             sum(coalesce(cache_read_tokens, 0)) AS cache_read_tokens
      FROM assistant_usage_events
      WHERE session_id = ?
      GROUP BY model
      ORDER BY calls DESC
    `).all(sessionId)
    if (!rows.length) return null
    const sum = (key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0)
    return {
      model: rows[0].model,
      inputTokens: sum('input_tokens'),
      outputTokens: sum('output_tokens'),
      cacheReadTokens: sum('cache_read_tokens'),
    }
  } catch {
    return null
  }
}

export function loadCopilotTranscript(sessionId, storePath = resolveCopilotStorePath()) {
  if (!validSessionId(sessionId)) return null
  if (!existsSync(storePath)) return null

  const db = new DatabaseSync(storePath, { readOnly: true })
  try {
    const session = db.prepare(`
      SELECT *
      FROM sessions
      WHERE id = ?
    `).get(sessionId)
    if (!session) return null
    const usage = readCopilotUsage(db, sessionId)

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
        ...(typeof session.branch === 'string' && session.branch ? { branch: session.branch } : {}),
        ...(usage ? { usage } : {}),
      },
    }, ...messages]
  } finally {
    db.close()
  }
}

function hasDurableConversation(records) {
  if (!Array.isArray(records)) return false
  const hasUser = records.some((record) => (
    record?.type === 'user'
    && typeof record.message?.content === 'string'
    && record.message.content.trim()
  ))
  const hasAssistant = records.some((record) => (
    record?.type === 'assistant'
    && typeof record.message?.content === 'string'
    && record.message.content.trim()
  ))
  return Boolean(hasUser && hasAssistant)
}

export async function loadCopilotTranscriptWhenReady(
  sessionId,
  storePath = resolveCopilotStorePath(),
  { maxRetries = 8, delayMs = 250 } = {},
) {
  const boundedRetries = Number.isInteger(maxRetries) ? Math.min(Math.max(maxRetries, 0), 20) : 8
  const boundedDelay = Number.isFinite(delayMs) ? Math.min(Math.max(delayMs, 0), 1_000) : 250
  let records = loadCopilotTranscript(sessionId, storePath)

  for (let retry = 0; retry < boundedRetries && !hasDurableConversation(records); retry++) {
    await new Promise((resolve) => setTimeout(resolve, boundedDelay))
    records = loadCopilotTranscript(sessionId, storePath)
  }

  return hasDurableConversation(records) ? records : null
}
