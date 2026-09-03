import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { captureQueueRoot, hasCaptureReceipt, readCaptureJob } from './session-capture-queue.mjs'

const root = captureQueueRoot()
const pendingDir = join(root, 'pending')
const failedDir = join(root, 'failed')
const lockDir = join(root, 'drain.lock')
const captureScript = join(import.meta.dirname, 'claude-session-capture.mjs')
const MAX_ATTEMPTS = 5

function log(message) {
  mkdirSync(root, { recursive: true })
  appendFileSync(join(root, 'capture.log'), `${new Date().toISOString()} ${message}\n`, 'utf8')
}

function lockOwnerAlive() {
  try {
    const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'))
    process.kill(owner.pid, 0)
    return true
  } catch {
    return false
  }
}

function acquireLock() {
  mkdirSync(root, { recursive: true })
  try {
    mkdirSync(lockDir)
  } catch (err) {
    if (err?.code !== 'EEXIST') return false
    const age = Date.now() - statSync(lockDir).mtimeMs
    if (lockOwnerAlive() || age < 300_000) return false
    rmSync(lockDir, { recursive: true, force: true })
    try { mkdirSync(lockDir) } catch { return false }
  }
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8')
  return true
}

function releaseLock() {
  try { rmSync(lockDir, { recursive: true, force: true }) } catch {}
}

function persistFailure(path, job, stderr) {
  const attempts = (job.attempts || 0) + 1
  const updated = { ...job, attempts, lastError: stderr.slice(-2000), lastAttemptAt: new Date().toISOString() }
  if (attempts >= MAX_ATTEMPTS) {
    mkdirSync(failedDir, { recursive: true })
    writeFileSync(path, JSON.stringify(updated), 'utf8')
    renameSync(path, join(failedDir, path.split(/[\\/]/).pop()))
    log(`dead-letter ${job.client}/${job.sessionId} after ${attempts} attempts`)
    return
  }
  writeFileSync(path, JSON.stringify(updated), 'utf8')
  log(`retry ${job.client}/${job.sessionId} attempt ${attempts}: ${stderr.slice(-500) || 'no receipt'}`)
}

function drainJob(path) {
  let job
  try {
    job = readCaptureJob(path)
  } catch (err) {
    mkdirSync(failedDir, { recursive: true })
    renameSync(path, join(failedDir, path.split(/[\\/]/).pop()))
    log(`invalid job ${path}: ${err.message}`)
    return
  }
  if (hasCaptureReceipt(job.client, job.sessionId)) {
    unlinkSync(path)
    return
  }
  const encoded = Buffer.from(JSON.stringify(job.payload), 'utf8').toString('base64')
  const result = spawnSync(process.execPath, [captureScript, '--hook-payload-base64', encoded, '--queue-worker'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 150_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  if (hasCaptureReceipt(job.client, job.sessionId)) {
    unlinkSync(path)
    log(`captured ${job.client}/${job.sessionId}`)
  } else if (result.status === 3) {
    unlinkSync(path)
    log(`skipped non-substantive ${job.client}/${job.sessionId}`)
  } else {
    persistFailure(path, job, `${result.error?.message || ''}\n${result.stderr || ''}`.trim())
  }
}

if (acquireLock()) {
  try {
    while (existsSync(pendingDir)) {
      const files = readdirSync(pendingDir).filter((name) => name.endsWith('.json')).sort()
      if (files.length === 0) break
      for (const file of files) drainJob(join(pendingDir, file))
      if (readdirSync(pendingDir).filter((name) => name.endsWith('.json')).length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  } finally {
    releaseLock()
  }
}
