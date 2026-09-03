// Shells the requested engine CLI in a background child process and pipes
// stdout/stderr into the Aeon session timeline. Holds a live registry so
// /kill/:id can SIGTERM the process.
//
// runEngine() is the shared machinery: push mode (/spawn) and poll mode
// (AI Hangar claim loop) both go through it, then attach their own exit
// handling on top.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { hostname } from 'node:os'
import { resolve, sep } from 'node:path'
import type { CallbackContext } from './callback.js'
import { patchSession, postEvent, postEventsBatch } from './callback.js'
import { jsonbSafeChunks, type StreamParser, type TypedEvent } from './stream-parser.js'

export type Engine = 'claude' | 'codex' | 'copilot'

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
  // Set by killSession so the exit handler reports 'killed' however the
  // process actually died — on Windows a tree kill has no exit signal.
  killed: boolean
}

const live = new Map<string, LiveSession>()

function repoRoot(): string {
  return resolve(process.env.KAIROS_WORKER_REPO_ROOT ?? process.cwd())
}

// `repo` is treated as a sibling directory under the root — the operator can
// override the root with KAIROS_WORKER_REPO_ROOT if their layout differs.
//
// /spawn only shape-checks its payload, so a repo of '../../Windows/System32'
// or an absolute path would otherwise resolve outside the root and run the
// engine — with --allow-all-tools — somewhere the operator never sanctioned.
export function resolveRepoPath(repo: string | null): string {
  const root = repoRoot()
  if (!repo) return root
  const target = resolve(root, repo)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`repo "${repo}" resolves outside the worker repo root — spawn refused`)
  }
  return target
}

function buildArgs(engine: Engine, prompt: string): string[] {
  if (engine === 'claude') {
    // `-p` runs in headless mode and prints to stdout.
    return ['-p', prompt]
  }
  if (engine === 'copilot') {
    return ['-p', prompt, '--allow-all-tools', '--no-ask-user']
  }
  // codex: subject to D24 / D25 — placeholder for now.
  return ['exec', prompt]
}

const PUSH_BINS: Record<Engine, () => string> = {
  claude: () => process.env.KAIROS_CLAUDE_BIN ?? 'claude',
  copilot: () => process.env.KAIROS_COPILOT_BIN ?? 'copilot',
  codex: () => process.env.KAIROS_CODEX_BIN ?? 'codex',
}

export interface RunEngineOptions {
  sessionId: string
  ctx: CallbackContext
  bin: string
  args: string[]
  cwd: string
  extraEnv?: Record<string, string>
  // Poll mode keeps stdout so the terminal result envelope can be extracted.
  capture?: boolean
  nextSeq?: () => number
  // Poll mode coalesces stdout into ~2s batches so a chatty stream doesn't
  // spend Aeon's 60 writes/min budget before the terminal post lands.
  batchStdout?: boolean
  // Typed telemetry (Flight Deck): stream output goes through this parser and
  // lands as batched typed events; only unparseable lines fall back to the
  // raw message path above. Same 2s flush cadence, same write budget.
  parser?: StreamParser
}

export interface RunHandle {
  child: ChildProcess
  nextSeq: () => number
  captured: () => string
  killed: () => boolean
}

export function createSeq(start = 1): () => number {
  let value = start
  return () => value++
}

// ── binary resolution ────────────────────────────────────────────────────

interface ResolvedBin {
  command: string
  shell: boolean
  // A .cmd/.bat target re-expands `%*`, which parses argv a second time.
  shim: boolean
}

const binCache = new Map<string, ResolvedBin>()

function isShim(path: string): boolean {
  return /\.(cmd|bat)$/i.test(path)
}

// A real executable is spawned directly: argv goes to the child untouched and
// no shell ever parses it. Only .cmd/.bat shims (codex) need cmd.exe, and they
// are the only ones that pay the escaping tax below.
function probeBin(bin: string): ResolvedBin {
  if (process.platform !== 'win32') return { command: bin, shell: false, shim: false }
  if (/[\\/]/.test(bin)) return { command: bin, shell: isShim(bin), shim: isShim(bin) }

  const res = spawnSync('where', [bin], { encoding: 'utf8', windowsHide: true })
  const hits = res.status === 0
    ? (res.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : []

  const exe = hits.find((hit) => hit.toLowerCase().endsWith('.exe'))
  if (exe) return { command: exe, shell: false, shim: false }

  const shim = hits.find(isShim)
  if (shim) return { command: shim, shell: true, shim: true }

  // Nothing on PATH — let the spawn fail and surface as an 'error' event.
  // Escaped as a shim because that is the stricter of the two.
  return { command: bin, shell: true, shim: true }
}

export function resolveBin(bin: string): ResolvedBin {
  const cached = binCache.get(bin)
  if (cached) return cached
  const resolved = probeBin(bin)
  binCache.set(bin, resolved)
  console.log(`[worker/spawn] "${bin}" → ${resolved.command}${resolved.shell ? ' (via cmd.exe)' : ''}`)
  return resolved
}

// ── argv escaping (shim path only) ───────────────────────────────────────

// The MSVCRT quoting rules the child's own parser applies: backslashes only
// matter in front of a quote, where they double and the quote gets escaped.
function quoteForCrt(arg: string): string {
  let out = '"'
  let slashes = 0
  for (const ch of arg) {
    if (ch === '\\') {
      slashes++
      continue
    }
    if (ch === '"') {
      out += '\\'.repeat(slashes * 2 + 1) + '"'
      slashes = 0
      continue
    }
    out += '\\'.repeat(slashes) + ch
    slashes = 0
  }
  return `${out}${'\\'.repeat(slashes * 2)}"`
}

function escapeCarets(text: string): string {
  return text.replace(/[()%!^"<>&|]/g, '^$&')
}

// Several parsers see this string in sequence and each one consumes a layer of
// escaping: cmd.exe reading the `/c` line, then — for a .cmd/.bat shim, which
// re-expands `%*` — cmd.exe again, and finally the child's own CRT. `\"` means
// nothing to cmd at any of those stages, which is how `a" & calc & "b` used to
// break out of the quotes and run calc (the CVE-2024-24576 shape). Escaping
// once per cmd pass makes every metacharacter arrive as a literal.
export function quoteForCmd(arg: string, shim: boolean): string {
  if (arg && /^[A-Za-z0-9_:./\\-]+$/.test(arg)) return arg
  const once = escapeCarets(quoteForCrt(arg))
  return shim ? escapeCarets(once) : once
}

export function runEngine(opts: RunEngineOptions): RunHandle {
  const resolved = resolveBin(opts.bin)
  const args = resolved.shell
    ? opts.args.map((arg) => quoteForCmd(arg, resolved.shim))
    : opts.args

  const child = spawn(resolved.command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.extraEnv },
    shell: resolved.shell,
  })

  // Close stdin so `claude -p` doesn't sit waiting 3s for piped input.
  // Platform-agnostic; works with shell: true on Windows where 'ignore'
  // in the stdio option triggers a DLL init failure under cmd.exe.
  child.stdin?.end()

  const session: LiveSession = { child, startedAt: Date.now(), seq: 1, killed: false }
  live.set(opts.sessionId, session)

  const nextSeq = opts.nextSeq ?? (() => session.seq++)

  let buffer = ''
  const CAPTURE_LIMIT = 400_000
  const EVENT_LIMIT = 8000
  const FLUSH_MS = 2000
  const FLUSH_BYTES = 6000
  const BATCH_MAX_EVENTS = 40
  // Bursts must not defeat the pacing the 60 writes/min budget relies on: a
  // size-triggered flush still waits out this floor. The cap bounds memory on
  // a stalled network — beyond it the oldest telemetry is dropped (warned),
  // never the process.
  const MIN_BATCH_INTERVAL_MS = 1500
  const PENDING_HARD_CAP = 1000
  // The raw buffer drains on a paced flush, so a stalled network (or a burst
  // faster than the pacing floor) is the one thing that can let it grow for
  // the whole mission. Past this it is handed to the batch queue immediately,
  // which is itself capped and paced.
  const RAW_HARD_CAP = 1_000_000

  let pending = ''
  let pendingEvents: TypedEvent[] = []
  let flushTimer: NodeJS.Timeout | null = null
  let lastBatchFlushAt = 0

  // The parser reads UNTRUSTED engine output. A throw inside it used to be an
  // uncaught exception on the stdout 'data' handler, which kills the runner
  // process and orphans every concurrent mission — so it degrades to the raw
  // text path instead. Logged at most PARSER_FAIL_LOG_LIMIT times: a parser
  // that throws on one line usually throws on all of them.
  const PARSER_FAIL_LOG_LIMIT = 3
  let parserFailures = 0
  const parserThrew = (stage: string, err: unknown): void => {
    parserFailures++
    if (parserFailures <= PARSER_FAIL_LOG_LIMIT) {
      console.error(
        `[worker/spawn] ${opts.sessionId} stream parser ${stage} threw (#${parserFailures}) — falling back to raw output`,
        err,
      )
    }
  }

  // Unbatched push mode (/spawn) only: one immediate post per chunk. Every
  // batched path goes through queueRaw instead.
  const emit = (text: string): void => {
    for (const chunk of jsonbSafeChunks(text, EVENT_LIMIT)) {
      void postEvent(opts.ctx, {
        seq: nextSeq(),
        kind: 'message',
        payload: { stream: 'stdout', text: chunk },
      })
    }
  }

  // Raw text becomes ordinary 'message' events — the exact shape emit() posted
  // — so degraded output rides the same batched, paced write path as typed
  // telemetry. Posting it directly cost one write per EVENT_LIMIT chars, so
  // 100KB of fallback output spent ~13 of the 60 writes/min budget in one
  // burst: precisely when the terminal result post still has to get through.
  const queueRaw = (text: string): void => {
    for (const chunk of jsonbSafeChunks(text, EVENT_LIMIT)) {
      pendingEvents.push({ kind: 'message', payload: { stream: 'stdout', text: chunk } })
    }
  }

  const appendRaw = (text: string): void => {
    pending += text
    if (pending.length < RAW_HARD_CAP) return
    const overflow = pending
    pending = ''
    queueRaw(overflow)
  }

  const flush = (): void => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (pending) {
      const text = pending
      pending = ''
      queueRaw(text)
    }
    if (pendingEvents.length === 0) return
    // seqs are assigned at flush so typed events interleave correctly with the
    // stderr/terminal posts sharing the same counter.
    // postEventsBatch chunks to the server's batch limit internally.
    const batch = pendingEvents.map((e) => ({
      seq: nextSeq(),
      kind: e.kind,
      toolName: e.toolName ?? null,
      payload: e.payload,
    }))
    pendingEvents = []
    lastBatchFlushAt = Date.now()
    void postEventsBatch(opts.ctx, batch)
  }

  const scheduleFlush = (): void => {
    if (pendingEvents.length > PENDING_HARD_CAP) {
      console.warn(`[worker/spawn] ${opts.sessionId} event backlog over ${PENDING_HARD_CAP} — dropping oldest`)
      pendingEvents = pendingEvents.slice(-PENDING_HARD_CAP)
    }
    const sizeTriggered = pendingEvents.length >= BATCH_MAX_EVENTS || pending.length >= FLUSH_BYTES
    if (sizeTriggered) {
      const wait = MIN_BATCH_INTERVAL_MS - (Date.now() - lastBatchFlushAt)
      if (wait <= 0) return flush()
      if (!flushTimer) flushTimer = setTimeout(flush, wait)
      return
    }
    if ((pendingEvents.length > 0 || pending) && !flushTimer) flushTimer = setTimeout(flush, FLUSH_MS)
  }

  // Stream end: drain what the parser still buffers (partial line, pending
  // usage) before the final flush.
  const finalFlush = (): void => {
    if (opts.parser) {
      try {
        const out = opts.parser.flush()
        pendingEvents.push(...out.events)
        if (out.raw) appendRaw(out.raw)
      } catch (err) {
        // Whatever the parser still buffered is lost with it — the flush
        // below still posts everything already queued, and the terminal
        // envelope is read from the captured stdout, not from the parser.
        parserThrew('flush', err)
      }
    }
    flush()
  }

  child.stdout?.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8')
    if (opts.capture) {
      buffer += text
      if (buffer.length > CAPTURE_LIMIT) buffer = buffer.slice(-CAPTURE_LIMIT)
    }
    if (opts.parser) {
      try {
        const out = opts.parser.feed(text)
        pendingEvents.push(...out.events)
        if (out.raw) appendRaw(out.raw)
      } catch (err) {
        parserThrew('feed', err)
        appendRaw(text)
      }
      return scheduleFlush()
    }
    if (!opts.batchStdout) {
      emit(text.slice(0, EVENT_LIMIT))
      return
    }
    appendRaw(text)
    scheduleFlush()
  })

  // Registered before the caller's own 'close' handler, so the tail of the
  // transcript is always posted ahead of the terminal stop/result events.
  child.stdout?.on('end', finalFlush)
  child.on('close', finalFlush)

  child.stderr?.on('data', (buf: Buffer) => {
    void postEvent(opts.ctx, {
      seq: nextSeq(),
      kind: 'error',
      payload: { stream: 'stderr', text: jsonbSafeChunks(buf.toString('utf8'), 8000)[0] ?? '' },
    })
  })

  return { child, nextSeq, captured: () => buffer, killed: () => session.killed }
}

export function releaseSession(sessionId: string): void {
  live.delete(sessionId)
}

export async function startSession(req: SpawnRequest): Promise<{ pid: number; workerHost: string }> {
  const ctx: CallbackContext = {
    sessionId: req.sessionId,
    callbackBaseUrl: req.callbackBaseUrl,
    callbackToken: req.callbackToken,
  }

  const pickBin = PUSH_BINS[req.engine]
  if (!pickBin) throw new Error(`unsupported engine "${req.engine}"`)

  const cwd = resolveRepoPath(req.repo)
  const args = buildArgs(req.engine, req.prompt)
  const bin = pickBin()

  console.log(`[worker/spawn] ${req.sessionId} engine=${req.engine} cwd=${cwd}`)

  // Inject session context so the Claude Code PostToolUse / Stop hooks can
  // POST events back to Aeon. The hook script reads these env vars.
  const { child, nextSeq, killed } = runEngine({
    sessionId: req.sessionId,
    ctx,
    bin,
    args,
    cwd,
    extraEnv: {
      KAIROS_SESSION_ID: req.sessionId,
      KAIROS_CALLBACK_URL: req.callbackBaseUrl,
      KAIROS_CALLBACK_TOKEN: req.callbackToken,
    },
  })

  const host = hostname()
  let settled = false

  child.on('error', (err) => {
    if (settled) return
    settled = true
    void postEvent(ctx, {
      seq: nextSeq(),
      kind: 'error',
      payload: { message: err.message },
    })
    void patchSession(ctx, { status: 'failed', endedAt: new Date().toISOString() })
    releaseSession(req.sessionId)
  })

  // 'close', not 'exit': stdio is still draining when 'exit' fires, so the last
  // chunk of the transcript would be posted after the terminal status.
  child.on('close', (code, signal) => {
    if (settled) return
    settled = true
    const status = killed() || signal === 'SIGTERM' ? 'killed' : (code === 0 ? 'succeeded' : 'failed')
    void postEvent(ctx, {
      seq: nextSeq(),
      kind: 'stop',
      payload: { exitCode: code, signal },
    })
    void patchSession(ctx, {
      status,
      exitCode: code,
      endedAt: new Date().toISOString(),
    })
    releaseSession(req.sessionId)
  })

  return { pid: child.pid ?? -1, workerHost: host }
}

export function killSession(sessionId: string): boolean {
  const session = live.get(sessionId)
  if (!session) return false
  session.killed = true

  const pid = session.child.pid
  // On Windows the child is the cmd.exe shim `shell: true` created; a plain
  // SIGTERM ends the shim and leaves the engine running (verified 2026-08-20),
  // so the whole tree has to go.
  if (process.platform === 'win32' && pid) {
    const res = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    if (res.status !== 0) session.child.kill('SIGTERM')
    return true
  }

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
