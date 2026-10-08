import { spawn } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENTS = new Set(['claude', 'codex', 'copilot'])
const SESSION_ID = /^[A-Za-z0-9-]{1,128}$/

export function captureQueueRoot() {
  return process.env.AEON_CAPTURE_HOME || join(homedir(), '.aeon', 'session-capture')
}

function validIdentity(client, sessionId) {
  return CLIENTS.has(client) && typeof sessionId === 'string' && SESSION_ID.test(sessionId)
}

function writeExclusiveAtomic(path, content) {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tempPath, content, { encoding: 'utf8', flag: 'wx' })
  try {
    linkSync(tempPath, path)
    unlinkSync(tempPath)
    return true
  } catch (err) {
    try { unlinkSync(tempPath) } catch {}
    if (existsSync(path)) return false
    throw err
  }
}

function clientMarkerPath(folder, client, sessionId) {
  if (!validIdentity(client, sessionId)) return null
  const homes = {
    claude: process.env.CLAUDE_HOME || join(homedir(), '.claude'),
    codex: process.env.CODEX_HOME || join(homedir(), '.codex'),
    copilot: process.env.COPILOT_HOME || join(homedir(), '.copilot'),
  }
  return join(homes[client], folder, sessionId)
}

export function captureReceiptPath(client, sessionId) {
  return clientMarkerPath('aeon-capture-receipts', client, sessionId)
}

export function captureSkipPath(client, sessionId) {
  return clientMarkerPath('aeon-capture-skips', client, sessionId)
}

export function hasCaptureSkip(client, sessionId) {
  const path = captureSkipPath(client, sessionId)
  return Boolean(path) && existsSync(path)
}

export function recordCaptureSkip(client, sessionId, reason = 'non-substantive') {
  const path = captureSkipPath(client, sessionId)
  if (!path) return false
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${new Date().toISOString()} ${reason}`, 'utf8')
    return true
  } catch {
    return false
  }
}

export function hasCaptureReceipt(client, sessionId) {
  const path = captureReceiptPath(client, sessionId)
  if (!path) return false
  try {
    return statSync(path).size > 0
  } catch {
    return false
  }
}

export function recordCaptureReceipt(client, sessionId, memoryId) {
  const path = captureReceiptPath(client, sessionId)
  if (!path || typeof memoryId !== 'string' || !memoryId) return false
  try {
    mkdirSync(dirname(path), { recursive: true })
    return writeExclusiveAtomic(path, memoryId) || hasCaptureReceipt(client, sessionId)
  } catch {
    return false
  }
}

export function enqueueCapture(payload) {
  const client = payload?.client || 'claude'
  const sessionId = payload?.session_id
  if (!validIdentity(client, sessionId) || hasCaptureReceipt(client, sessionId)) return null
  if (payload?.reason === 'backfill' && hasCaptureSkip(client, sessionId)) return null
  const pendingDir = join(captureQueueRoot(), 'pending')
  mkdirSync(pendingDir, { recursive: true })
  const path = join(pendingDir, `${client}-${sessionId}.json`)
  const job = { version: 1, client, sessionId, payload: { ...payload, client }, attempts: 0, createdAt: new Date().toISOString() }
  writeExclusiveAtomic(path, JSON.stringify(job))
  return path
}

export function readCaptureJob(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function startCaptureDrain() {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'session-capture-drain.mjs')
  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('error', () => {})
  child.unref()
}

export function enqueueAndDrain(payload) {
  const path = enqueueCapture(payload)
  if (path || existsSync(join(captureQueueRoot(), 'pending'))) startCaptureDrain()
  return path
}
