// Shells the requested engine CLI in a background child process and pipes
// stdout/stderr into the Aeon session timeline. Holds a live registry so
// /kill/:id can SIGTERM the process.

import { spawn, type ChildProcess } from 'node:child_process'
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import type { CallbackContext } from './callback.js'
import { patchSession, postEvent } from './callback.js'

export type Engine = 'claude' | 'codex'

export interface SpawnRequest {
  sessionId: string
  engine: Engine
  repo: string | null
  branch: string | null
  goal: string
  prompt: string
  callbackToken: string
  callbackBaseUrl: string
}

interface LiveSession {
  child: ChildProcess
  startedAt: number
  seq: number
}

const live = new Map<string, LiveSession>()

const REPO_ROOT = process.env.KAIROS_WORKER_REPO_ROOT ?? process.cwd()

function resolveRepoPath(repo: string | null): string {
  if (!repo) return REPO_ROOT
  // Naive: treat `repo` as a sibling directory under REPO_ROOT. The operator
  // can override with KAIROS_WORKER_REPO_ROOT if their layout differs.
  return resolve(REPO_ROOT, repo)
}

function buildArgs(engine: Engine, prompt: string): string[] {
  if (engine === 'claude') {
    // `-p` runs in headless mode and prints to stdout.
    return ['-p', prompt]
  }
  // codex: subject to D24 / D25 — placeholder for now.
  return ['exec', prompt]
}

export async function startSession(req: SpawnRequest): Promise<{ pid: number; workerHost: string }> {
  const ctx: CallbackContext = {
    sessionId: req.sessionId,
    callbackBaseUrl: req.callbackBaseUrl,
    callbackToken: req.callbackToken,
  }

  const cwd = resolveRepoPath(req.repo)
  const args = buildArgs(req.engine, req.prompt)
  const bin = req.engine === 'claude' ? (process.env.KAIROS_CLAUDE_BIN ?? 'claude') : (process.env.KAIROS_CODEX_BIN ?? 'codex')

  console.log(`[worker/spawn] ${req.sessionId} engine=${req.engine} cwd=${cwd}`)

  // Inject session context so the Claude Code PostToolUse / Stop hooks can
  // POST events back to Aeon. The hook script reads these env vars.
  const child = spawn(bin, args, {
    cwd,
    env: {
      ...process.env,
      KAIROS_SESSION_ID: req.sessionId,
      KAIROS_CALLBACK_URL: req.callbackBaseUrl,
      KAIROS_CALLBACK_TOKEN: req.callbackToken,
    },
    shell: process.platform === 'win32',
  })

  // Close stdin so `claude -p` doesn't sit waiting 3s for piped input.
  // Platform-agnostic; works with shell: true on Windows where 'ignore'
  // in the stdio option triggers a DLL init failure under cmd.exe.
  child.stdin?.end()

  const session: LiveSession = { child, startedAt: Date.now(), seq: 1 }
  live.set(req.sessionId, session)

  const host = hostname()

  child.stdout?.on('data', (buf: Buffer) => {
    void postEvent(ctx, {
      seq: session.seq++,
      kind: 'message',
      payload: { stream: 'stdout', text: buf.toString('utf8').slice(0, 8000) },
    })
  })

  child.stderr?.on('data', (buf: Buffer) => {
    void postEvent(ctx, {
      seq: session.seq++,
      kind: 'error',
      payload: { stream: 'stderr', text: buf.toString('utf8').slice(0, 8000) },
    })
  })

  child.on('error', (err) => {
    void postEvent(ctx, {
      seq: session.seq++,
      kind: 'error',
      payload: { message: err.message },
    })
    void patchSession(ctx, { status: 'failed', endedAt: new Date().toISOString() })
    live.delete(req.sessionId)
  })

  child.on('exit', (code, signal) => {
    const status = signal === 'SIGTERM' ? 'killed' : (code === 0 ? 'succeeded' : 'failed')
    void postEvent(ctx, {
      seq: session.seq++,
      kind: 'stop',
      payload: { exitCode: code, signal },
    })
    void patchSession(ctx, {
      status,
      exitCode: code,
      endedAt: new Date().toISOString(),
    })
    live.delete(req.sessionId)
  })

  return { pid: child.pid ?? -1, workerHost: host }
}

export function killSession(sessionId: string): boolean {
  const session = live.get(sessionId)
  if (!session) return false
  session.child.kill('SIGTERM')
  return true
}

export function listLive(): Array<{ sessionId: string; pid: number | undefined; uptimeMs: number }> {
  const out: Array<{ sessionId: string; pid: number | undefined; uptimeMs: number }> = []
  const now = Date.now()
  for (const [sessionId, session] of live) {
    out.push({ sessionId, pid: session.child.pid, uptimeMs: now - session.startedAt })
  }
  return out
}
