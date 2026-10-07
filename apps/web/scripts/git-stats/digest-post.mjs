import { existsSync, readFileSync } from 'node:fs'

export const MIN_INTERVAL_MS = 1100
export const MAX_TRIES = 3
const TIMEOUT_MS = 15000

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Fill process env from a dotenv file without overriding values already set. */
export function loadEnvFile(path, env = process.env) {
  if (!existsSync(path)) return false
  for (const raw of readFileSync(path, 'utf8').replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (!env[m[1]]) env[m[1]] = val
  }
  return true
}

/** Paced POST /api/v1/memories client: one write per interval, retries 429/5xx/network up to MAX_TRIES. */
export class AeonPoster {
  #apiKey

  constructor({ baseUrl, apiKey, fetchImpl = fetch, sleep = realSleep, now = Date.now, minIntervalMs = MIN_INTERVAL_MS, maxTries = MAX_TRIES, log = () => {} }) {
    if (!apiKey) throw new Error('AEON_API_KEY not set')
    this.url = `${String(baseUrl || 'http://localhost:3000').replace(/\/+$/, '')}/api/v1/memories`
    this.#apiKey = apiKey
    Object.assign(this, { fetchImpl, sleep, now, minIntervalMs, maxTries, log })
    this.lastWriteAt = null
    this.writes = 0
  }

  async #pace() {
    if (this.lastWriteAt !== null) {
      const wait = this.lastWriteAt + this.minIntervalMs - this.now()
      if (wait > 0) await this.sleep(wait)
    }
    this.lastWriteAt = this.now()
    this.writes++
  }

  async #once(payload) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#apiKey}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      return { res, text: await res.text() }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Returns { ok, status, memoryId, error }. */
  async post(payload) {
    let last = { ok: false, status: 0, memoryId: null, error: 'not attempted' }
    for (let attempt = 0; attempt < this.maxTries; attempt++) {
      await this.#pace()
      let backoff = 1000 * 2 ** attempt
      try {
        const { res, text } = await this.#once(payload)
        if (res.ok) {
          let memoryId = null
          try {
            memoryId = JSON.parse(text)?.data?.id ?? null
          } catch {
            memoryId = null
          }
          return { ok: true, status: res.status, memoryId, error: null }
        }
        last = { ok: false, status: res.status, memoryId: null, error: text.slice(0, 300) }
        if (res.status !== 429 && res.status < 500) return last
        const retryAfter = Number(res.headers?.get?.('retry-after'))
        if (Number.isFinite(retryAfter) && retryAfter > 0) backoff = retryAfter * 1000
      } catch (err) {
        last = { ok: false, status: 0, memoryId: null, error: err.message }
      }
      if (attempt < this.maxTries - 1) {
        this.log(`retry ${payload.sourceMetadata?.externalId} after ${last.status || 'network error'} in ${backoff} ms`)
        await this.sleep(backoff)
      }
    }
    return last
  }
}
