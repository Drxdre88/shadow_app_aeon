// Read-only HTTP client for the retrieval eval: env loading, paced GETs, path adapters.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BASE = 'https://aeon.shadow-lab.ai'

export function readEnvLocal(path = resolve(WEB_DIR, '.env.local')) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

export function resolveConfig(env = process.env) {
  const local = readEnvLocal()
  const apiKey = env.AEON_API_KEY || local.AEON_API_KEY || ''
  const base = (env.AEON_BASE_URL || local.AEON_BASE_URL || DEFAULT_BASE).replace(/\/$/, '')
  return { apiKey, baseUrl: base }
}

export class ReadOnlyClient {
  constructor({ apiKey, baseUrl, delayMs = 350, timeoutMs = 30_000 }) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
    this.delayMs = delayMs
    this.timeoutMs = timeoutMs
    this.lastCall = 0
    this.calls = 0
  }

  async pace() {
    const wait = this.lastCall + this.delayMs - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.lastCall = Date.now()
  }

  async get(path, params = {}) {
    const url = new URL(path, this.baseUrl)
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(item))
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.pace()
      this.calls++
      let res
      try {
        res = await fetch(url, {
          method: 'GET',
          headers: { 'x-aeon-eval': '1', Authorization: `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(this.timeoutMs),
        })
      } catch (err) {
        if (attempt === 2) throw new Error(`network ${url.pathname}: ${err.cause?.code ?? err.message}`)
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
        continue
      }
      if (res.status === 429 || res.status === 503) {
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)))
        continue
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${url.pathname}: ${body.slice(0, 160)}`)
      }
      const json = await res.json()
      return json && typeof json === 'object' && 'data' in json ? json.data : json
    }
    throw new Error(`gave up after retries: ${url.pathname}`)
  }

  async search(query, limit, { expand, entity } = {}) {
    const data = await this.get('/api/v1/memories/search', { q: query, limit, expand, entity })
    const r = data.retrieval ?? {}
    // Score inputs captured so confidence floors can be tuned from saved runs.
    const results = (data.hits ?? []).map((h) => ({
      id: h.id, title: h.title, createdAt: h.createdAt, updatedAt: h.updatedAt, rank: h.rank,
      score: h.score, standing: h.standing ?? null, confidence: h.confidence ?? null, pinned: h.pinned,
      via: h.via ?? 'search',
    }))
    return { results, retrieval: data.retrieval ?? null, mode: r.mode }
  }

  async context(query, { budget = 4000, maxSources = 15, includePinned, includeToday, expand, entity } = {}) {
    const data = await this.get('/api/v1/memories/context', {
      query,
      budgetTokens: budget,
      maxSources,
      hops: 1,
      includePinned: includePinned === false ? 'false' : undefined,
      includeToday: includeToday === false ? 'false' : undefined,
      expand,
      entity,
    })
    const results = (data.sources ?? []).map((s) => ({
      id: s.id, title: s.title, section: s.section, score: s.score, via: s.via ?? 'search',
    }))
    return { results, retrieval: data.retrieval ?? null }
  }

  async memory(id) {
    return this.get(`/api/v1/memories/${id}`)
  }

  async pinnedIds() {
    const data = await this.get('/api/v1/memories', { pinned: 'true', limit: 200 })
    const rows = Array.isArray(data) ? data : data.memories ?? data.items ?? []
    return new Set(rows.map((m) => m.id))
  }
}

// Each adapter returns { results, retrieval }. opts.expand / opts.entity: true/false send =true|false; undefined omits it.
export function makePaths(client, opts) {
  const flag = (v) => (v === undefined || v === null ? undefined : String(Boolean(v)))
  const expand = flag(opts.expand)
  const entity = flag(opts.entity)
  const ctx = { budget: opts.budget, maxSources: opts.maxSources, expand, entity }
  return {
    search: (q) => client.search(q, Math.max(opts.k, 10), { expand, entity }),
    context: (q) => client.context(q, ctx),
    'context-nopin': (q) => client.context(q, { ...ctx, includePinned: false, includeToday: false }),
  }
}
