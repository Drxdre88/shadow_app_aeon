// Kairos spawn worker — minimal long-running Node service.
//
// The worker is intentionally tiny: one HTTP listener, no framework, no DB.
// It receives /spawn from the Aeon server, shells the requested engine CLI,
// and posts events back to Aeon over HTTPS. Authentication is a single
// shared bearer secret (KAIROS_WORKER_SECRET).
//
// Why a long-running process and not Vercel Cron + ephemeral?
//   Spawned CLI sessions can run minutes or hours; ephemeral functions die
//   when the request ends. Aeon's existing crons (briefer, snapshot) stay
//   on Vercel — those are short stateless inference calls. The worker is
//   the seam between Aeon and the local CLI.
//
// Deploy: run on the operator's dev box (or any always-on host) with
//   `npm run start --workspace=apps/kairos-worker`
// behind a reverse proxy that handles TLS. PM2 or Windows Service for
// persistence.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { startSession, killSession, listLive, type SpawnRequest } from './spawner.js'
import { getPollerState, startPoller } from './poller.js'

const PORT = Number(process.env.KAIROS_WORKER_PORT ?? '8787')
const SECRET = process.env.KAIROS_WORKER_SECRET

// 'push'  — Aeon calls /spawn (Kairos hands, unchanged default)
// 'poll'  — worker claims queued AI Hangar sessions from Aeon
// 'both'  — run either dispatch path
const RAW_MODE = (process.env.KAIROS_MODE ?? 'push').toLowerCase()
const MODE = RAW_MODE === 'poll' || RAW_MODE === 'both' ? RAW_MODE : 'push'

function authOk(req: IncomingMessage): boolean {
  if (!SECRET) return true // dev-mode: no auth
  const header = req.headers['authorization']
  return typeof header === 'string' && header === `Bearer ${SECRET}`
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolveBody(text ? JSON.parse(text) : {})
      } catch (err) {
        rejectBody(err)
      }
    })
    req.on('error', rejectBody)
  })
}

function isSpawnRequest(value: unknown): value is SpawnRequest {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.sessionId === 'string'
    && (v.engine === 'claude' || v.engine === 'codex' || v.engine === 'copilot')
    && typeof v.goal === 'string'
    && typeof v.prompt === 'string'
    && typeof v.callbackBaseUrl === 'string'
    && typeof v.callbackToken === 'string'
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) return send(res, 400, { error: 'bad_request' })

  if (req.method === 'GET' && req.url === '/health') {
    const poller = getPollerState()
    return send(res, 200, {
      ok: true,
      mode: MODE,
      lastPollAt: poller.lastPollAt,
      workerId: poller.workerId || null,
      live: listLive(),
    })
  }

  if (!authOk(req)) return send(res, 401, { error: 'unauthorized' })

  if (req.method === 'POST' && req.url === '/spawn') {
    let body: unknown
    try {
      body = await readJson(req)
    } catch {
      return send(res, 400, { error: 'invalid_json' })
    }
    if (!isSpawnRequest(body)) return send(res, 400, { error: 'invalid_payload' })

    try {
      const result = await startSession(body)
      return send(res, 202, { pid: result.pid, workerHost: result.workerHost })
    } catch (err) {
      console.error('[worker] spawn failed', err)
      return send(res, 500, { error: 'spawn_failed', detail: err instanceof Error ? err.message : 'unknown' })
    }
  }

  if (req.method === 'POST' && req.url.startsWith('/kill/')) {
    const sessionId = req.url.slice('/kill/'.length)
    const killed = killSession(sessionId)
    return send(res, killed ? 200 : 404, { killed })
  }

  return send(res, 404, { error: 'not_found' })
})

server.listen(PORT, () => {
  console.log(`[kairos-worker] listening on :${PORT} (mode=${MODE})`)
  if (RAW_MODE !== MODE) console.warn(`[kairos-worker] unknown KAIROS_MODE "${RAW_MODE}" — falling back to push`)
  if (!SECRET) console.warn('[kairos-worker] WARNING: KAIROS_WORKER_SECRET unset — no auth on /spawn')
  if (MODE === 'poll' || MODE === 'both') startPoller()
})
