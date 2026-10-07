import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LOCK_STALE_MS = 3 * 60 * 60 * 1000

export function defaultDigestHome() {
  return process.env.AEON_GIT_STATS_HOME || join(homedir(), '.aeon', 'git-stats')
}

function writeAtomic(path, text) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temp, text, 'utf8')
  renameSync(temp, path)
}

/** Local long-term history: daily snapshots, append-only history rows and post receipts. */
export class DigestStore {
  constructor(home = defaultDigestHome()) {
    this.home = home
    this.receiptsPath = join(home, 'receipts.json')
    this.historyPath = join(home, 'history.jsonl')
    this.lockPath = join(home, 'digest.lock')
  }

  ensure() {
    mkdirSync(join(this.home, 'daily'), { recursive: true })
  }

  readReceipts() {
    if (!existsSync(this.receiptsPath)) return { version: 1, days: {} }
    const data = JSON.parse(readFileSync(this.receiptsPath, 'utf8'))
    return { version: 1, ...data, days: data.days || {} }
  }

  #updateDay(day, mutate) {
    this.ensure()
    const receipts = this.readReceipts()
    const entry = receipts.days[day] || { repos: {}, complete: false }
    mutate(entry)
    receipts.days[day] = entry
    writeAtomic(this.receiptsPath, `${JSON.stringify(receipts, null, 2)}\n`)
    return entry
  }

  isPosted(day, slug) {
    return Boolean(this.readReceipts().days[day]?.repos?.[slug])
  }

  recordPost(day, slug, { memoryId = null, status = null } = {}) {
    return this.#updateDay(day, (e) => {
      e.repos = { ...e.repos, [slug]: { memoryId, status, postedAt: new Date().toISOString() } }
    })
  }

  markComplete(day, { activeRepos = 0 } = {}) {
    return this.#updateDay(day, (e) => {
      e.complete = true
      e.activeRepos = activeRepos
      e.completedAt = new Date().toISOString()
    })
  }

  writeDaily(day, snapshot) {
    this.ensure()
    const path = join(this.home, 'daily', `${day}.json`)
    writeAtomic(path, `${JSON.stringify(snapshot, null, 2)}\n`)
    return path
  }

  historyKeys() {
    if (!existsSync(this.historyPath)) return new Set()
    const keys = new Set()
    for (const line of readFileSync(this.historyPath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line)
        keys.add(`${row.day}|${row.repo}`)
      } catch {
        continue
      }
    }
    return keys
  }

  /** Append one row per repo-day not already present; returns the number appended. */
  appendHistory(rows) {
    this.ensure()
    const keys = this.historyKeys()
    const fresh = rows.filter((r) => !keys.has(`${r.day}|${r.repo}`))
    if (fresh.length) appendFileSync(this.historyPath, fresh.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
    return fresh.length
  }

  acquireLock() {
    this.ensure()
    try {
      writeFileSync(this.lockPath, `${process.pid} ${new Date().toISOString()}`, { flag: 'wx' })
      return true
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      if (Date.now() - statSync(this.lockPath).mtimeMs < LOCK_STALE_MS) return false
      unlinkSync(this.lockPath)
      return this.acquireLock()
    }
  }

  releaseLock() {
    try {
      unlinkSync(this.lockPath)
    } catch {
      // already gone
    }
  }
}
