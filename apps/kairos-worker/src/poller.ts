// AI Hangar pull dispatch. Instead of Aeon pushing /spawn at the worker, the
// worker polls Aeon, claims a queued session, prepares the repo branch, shells
// the engine, streams the transcript back and posts the terminal result
// envelope. NAT-friendly: nothing has to reach this host.
//
// Push mode is untouched — a poll-mode session never goes through /spawn.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AEON_API_KEY,
  AEON_BASE_URL,
  aeonFetch,
  patchSession,
  pollContext,
  postEvent,
  withRetry,
} from './callback.js'
import {
  collectText,
  decideFinalStatus,
  extractEnvelope,
  normalizeEnvelope,
  tryParse,
} from './envelope.js'
import { engineIds, getEngine, outFileFor, type EngineAdapter } from './engines.js'
import { getWorkerId, reposFilePath, resolveRepo, type RepoEntry } from './registry.js'
import { createSeq, killSession, releaseSession, runEngine } from './spawner.js'
import type { MissionStats, StreamParser } from './stream-parser.js'

const POLL_INTERVAL_MS = Number(process.env.KAIROS_POLL_INTERVAL_MS ?? '15000')
const HEARTBEAT_MS = Number(process.env.KAIROS_HEARTBEAT_MS ?? '30000')
const MAX_CONCURRENT = Number(process.env.KAIROS_MAX_CONCURRENT ?? '1')

export interface ClaimedSession {
  id: string
  engine: string
  repo: string | null
  branch: string | null
  goal?: string | null
  prompt?: string | null
  taskId?: string | null
  metadata?: Record<string, unknown> | null
}

interface HangarMeta {
  objective?: string
  instruction?: string
  subagents?: string[]
  outputMode?: string
  model?: string | null
}

// Every argv component that comes from the session row is held to this charset
// before it is ever passed to a process. Aeon validates the same shape server
// side; this is the layer that has to hold if that one is bypassed.
//
// The first character must be alphanumeric: a value that may start with '-' is
// a flag, and a model of '--dangerously-skip-permissions' would be handed
// straight to the engine CLI as an option rather than a value.
const SAFE_ARG = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/

export function unsafeArg(label: string, value: string | null | undefined): string | null {
  if (!value) return null
  return SAFE_ARG.test(value) ? null : `${label} contains unsupported characters — mission refused`
}

let workerId = ''
let activeCount = 0
let lastPollAt: string | null = null

export function getPollerState(): { workerId: string; active: number; lastPollAt: string | null } {
  return { workerId, active: activeCount, lastPollAt }
}

export function startPoller(): void {
  if (!AEON_API_KEY) {
    console.error('[worker/poll] KAIROS_AEON_API_KEY unset — poll mode disabled')
    return
  }
  workerId = getWorkerId()
  console.log(
    `[worker/poll] ${workerId} polling ${AEON_BASE_URL} every ${POLL_INTERVAL_MS}ms ` +
    `(max ${MAX_CONCURRENT} concurrent, registry ${reposFilePath()})`
  )
  void tick()
}

// Recursive setTimeout, never setInterval: a slow claim must not stack ticks.
async function tick(): Promise<void> {
  try {
    if (activeCount < MAX_CONCURRENT) await claimOnce()
  } catch (err) {
    console.error('[worker/poll] tick failed', err)
  } finally {
    setTimeout(() => void tick(), POLL_INTERVAL_MS)
  }
}

async function claimOnce(): Promise<void> {
  lastPollAt = new Date().toISOString()

  const res = await aeonFetch<{ session: ClaimedSession | null }>(
    AEON_BASE_URL,
    AEON_API_KEY,
    '/api/v1/sessions/claim',
    { method: 'POST', body: { workerId, engines: engineIds() } },
  )
  if (!res.ok) {
    if (res.status) console.error(`[worker/poll] claim rejected (${res.status})`)
    return
  }

  const session = res.data?.session ?? null
  if (!session) return

  activeCount++
  console.log(`[worker/poll] claimed ${session.id} engine=${session.engine} repo=${session.repo}`)
  await launch(session)
}

async function launch(session: ClaimedSession): Promise<void> {
  const ctx = pollContext(session.id)
  const nextSeq = createSeq(1)

  // Set once the repo is on a mission branch / the brief is on disk, so an
  // abort still leaves the checkout as it found it.
  let checkout: RepoEntry | null = null
  let brief: string | null = null

  let released = false
  const release = (): void => {
    if (released) return
    released = true
    activeCount--
    releaseSession(session.id)
  }

  const abort = async (message: string): Promise<void> => {
    console.error(`[worker/poll] ${session.id} ${message}`)
    await postEvent(ctx, { seq: nextSeq(), kind: 'error', payload: { message } })
    await patchSession(ctx, { status: 'failed', endedAt: new Date().toISOString() })
    if (brief) rmSync(brief, { force: true })
    if (checkout) restoreBranch(checkout)
    release()
  }

  try {
    const engine = getEngine(session.engine)
    if (!engine) return await abort(`unsupported engine "${session.engine}"`)

    const entry = resolveRepo(session.repo)
    if (!entry) {
      return await abort(`repo "${session.repo}" is not in ${reposFilePath()} — add it and re-run the mission`)
    }
    if (!existsSync(entry.path)) {
      return await abort(`repo "${entry.slug}" path does not exist on this host: ${entry.path}`)
    }

    const branch = session.branch?.trim() || `aeon/${(session.taskId ?? session.id).slice(0, 8)}`
    const meta = hangarMeta(session)
    const rejected = unsafeArg('branch', branch)
      ?? unsafeArg('model', meta.model)
      ?? unsafeArg('session id', session.id)
    if (rejected) return await abort(rejected)

    const prepared = prepareBranch(entry, branch)
    if (!prepared.ok) return await abort(prepared.error)
    checkout = entry

    const text = session.prompt?.trim() || buildDispatchPrompt(session, entry, branch, meta)
    // The brief goes to a file and argv carries a one-line pointer: a cmd.exe
    // command line cannot hold newlines and caps out around 8k chars, while a
    // card instruction can run to 20k.
    const briefFile = briefFileFor(session.id)
    writeFileSync(briefFile, text, 'utf8')
    brief = briefFile
    const prompt = briefPointer(entry, branch, meta, briefFile)

    const outFile = engine.envelopeSource === 'file' ? outFileFor(session.id) : null
    if (outFile) rmSync(outFile, { force: true })

    const args = engine.buildArgs(prompt, { model: meta.model ?? null, cwd: entry.path, outFile })
    console.log(`[worker/poll] ${session.id} → ${engine.bin} in ${entry.path} on ${branch}`)

    const parser = engine.streamParser?.() ?? null

    const handle = runEngine({
      sessionId: session.id,
      ctx,
      bin: engine.bin,
      args,
      cwd: entry.path,
      capture: true,
      batchStdout: true,
      parser: parser ?? undefined,
      nextSeq,
      extraEnv: {
        KAIROS_SESSION_ID: session.id,
        KAIROS_CALLBACK_URL: AEON_BASE_URL,
        KAIROS_CALLBACK_TOKEN: AEON_API_KEY,
        AEON_TASK_ID: session.taskId ?? '',
      },
    })

    await patchSession(ctx, {
      status: 'running',
      workerHost: hostname(),
      workerPid: handle.child.pid ?? null,
      startedAt: new Date().toISOString(),
    })

    const stopHeartbeat = startHeartbeat(session.id, () => {
      killSession(session.id)
    })

    handle.child.on('error', (err) => {
      if (released) return
      stopHeartbeat()
      void (async () => {
        await postEvent(ctx, { seq: nextSeq(), kind: 'error', payload: { message: err.message } })
        await patchSession(ctx, { status: 'failed', endedAt: new Date().toISOString() })
        rmSync(briefFile, { force: true })
        restoreBranch(entry)
        release()
      })()
    })

    // 'close', not 'exit': 'exit' fires while stdio is still draining, so the
    // envelope sitting in the last stdout chunk would be missing and a
    // successful mission would be reported as failed.
    handle.child.on('close', (code, signal) => {
      if (released) return
      stopHeartbeat()
      void finalize({
        ctx,
        nextSeq,
        engine,
        entry,
        outFile,
        briefFile,
        code,
        signal,
        killed: handle.killed(),
        stdout: handle.captured(),
        parser,
        release,
      })
    })
  } catch (err) {
    await abort(`launch failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

interface FinalizeArgs {
  ctx: ReturnType<typeof pollContext>
  nextSeq: () => number
  engine: EngineAdapter
  entry: RepoEntry
  outFile: string | null
  briefFile: string
  code: number | null
  signal: NodeJS.Signals | null
  killed: boolean
  stdout: string
  parser: StreamParser | null
  release: () => void
}

// Absent field = "the engine reported nothing". Counters keep genuine zeros;
// only cost is omit-when-zero (a $0 report is indistinguishable from no
// report). Single aggregation point — stats land here once (envelope +
// session PATCH) and nowhere else, so a second write site can never
// double-count.
export function missionStats(stats: MissionStats | null): Record<string, number | string> | null {
  if (!stats) return null
  const out: Record<string, number | string> = {}
  const counters: Array<[key: keyof MissionStats & string, value: number | undefined]> = [
    ['inputTokens', stats.inputTokens],
    ['outputTokens', stats.outputTokens],
    ['cacheReadTokens', stats.cacheReadTokens],
    ['cacheCreationTokens', stats.cacheCreationTokens],
    ['thinkingTokens', stats.thinkingTokens],
    ['numTurns', stats.numTurns],
    ['durationMs', stats.durationMs],
    ['durationApiMs', stats.durationApiMs],
  ]
  for (const [key, value] of counters) {
    if (value !== undefined && Number.isFinite(value)) out[key] = value
  }
  if (stats.totalCostUsd !== undefined && Number.isFinite(stats.totalCostUsd) && stats.totalCostUsd !== 0) {
    out.totalCostUsd = stats.totalCostUsd
  }
  out.toolCalls = stats.toolCalls
  if (stats.model) out.model = stats.model
  return Object.keys(out).length > 0 ? out : null
}

// POST /events answers a kind:'result' post with whether the envelope actually
// landed on the card. resultProcessed also reads false for a replay or an
// unlinked session, so only a resultError means Aeon refused the payload.
interface ResultAck {
  resultProcessed?: boolean
  resultError?: string
}

function envelopeRejection(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const ack = data as ResultAck
  return ack.resultProcessed === false && typeof ack.resultError === 'string' ? ack.resultError : null
}

async function finalize(args: FinalizeArgs): Promise<void> {
  const { ctx, nextSeq, engine, entry, outFile, briefFile, code, signal, killed, stdout, parser, release } = args
  const endedAt = new Date().toISOString()
  const wasKilled = killed || signal === 'SIGTERM'

  await postEvent(ctx, { seq: nextSeq(), kind: 'stop', payload: { exitCode: code, signal } })

  const envelope = normalizeEnvelope(readEnvelope(engine, stdout, outFile))
  const stats = missionStats(parser?.stats() ?? null)

  // The result event and the final status are the two writes that must land:
  // losing either leaves a finished mission showing as 'running' on the board.
  const base = envelope ?? {
    status: 'failed',
    outcome: 'blocked',
    summary: 'engine exited without a result envelope',
    raw_tail: stdout.slice(-2000),
  }
  const result = stats ? { ...base, stats } : base
  const reported = envelope && typeof envelope.status === 'string' ? envelope.status : null

  const seq = nextSeq()
  const ack = await withRetry<ResultAck>('result event', () =>
    postEvent<ResultAck>(ctx, { seq, kind: 'result', payload: result }))

  const rejection = envelopeRejection(ack.data)
  if (rejection) {
    console.error(`[worker/poll] Aeon refused the result envelope: ${rejection}`)
    await postEvent(ctx, {
      seq: nextSeq(),
      kind: 'error',
      payload: { message: `result envelope rejected by Aeon: ${rejection}` },
    })
  }

  const status = decideFinalStatus(reported, wasKilled, rejection !== null)
  const costUsd = typeof stats?.totalCostUsd === 'number' ? stats.totalCostUsd : undefined
  await withRetry('final status', () => patchSession(ctx, {
    status,
    exitCode: code,
    endedAt,
    ...(costUsd !== undefined ? { costUsd } : {}),
  }))

  if (outFile) rmSync(outFile, { force: true })
  rmSync(briefFile, { force: true })
  restoreBranch(entry)
  release()
}

// ── heartbeat ────────────────────────────────────────────────────────────

// Beats while the child runs and, in the same tick, checks whether Aeon has
// flipped the session to 'killed' — cooperative kill without an inbound port.
function startHeartbeat(sessionId: string, onLost: () => void): () => void {
  let stopped = false
  let timer: NodeJS.Timeout | null = null

  const beat = async (): Promise<void> => {
    if (stopped) return

    const hb = await aeonFetch(AEON_BASE_URL, AEON_API_KEY, `/api/v1/sessions/${sessionId}/heartbeat`, {
      method: 'POST',
      body: { workerId },
    })
    if (hb.status === 404) {
      console.warn(`[worker/poll] ${sessionId} claim lost (re-claimed elsewhere) — stopping child`)
      onLost()
      return
    }

    const current = await aeonFetch(AEON_BASE_URL, AEON_API_KEY, `/api/v1/sessions/${sessionId}`)
    if (readStatus(current.data) === 'killed') {
      console.log(`[worker/poll] ${sessionId} killed from Aeon — SIGTERM`)
      onLost()
      return
    }

    if (!stopped) timer = setTimeout(() => void beat(), HEARTBEAT_MS)
  }

  timer = setTimeout(() => void beat(), HEARTBEAT_MS)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

// GET /sessions/:id returns the row directly; heartbeat wraps it in { session }.
function readStatus(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const shape = data as { status?: unknown; session?: { status?: unknown } }
  const status = shape.session?.status ?? shape.status
  return typeof status === 'string' ? status : null
}

// ── git ──────────────────────────────────────────────────────────────────

function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return {
    ok: res.status === 0,
    stdout: res.stdout ?? '',
    stderr: (res.stderr ?? '') || (res.error ? res.error.message : ''),
  }
}

function prepareBranch(entry: RepoEntry, branch: string): { ok: true } | { ok: false; error: string } {
  // The runner works in the operator's live checkout, so uncommitted work would
  // be carried onto the mission branch and mixed with the agent's edits. Refuse
  // before touching anything rather than claim the damage.
  // TODO(sprint-2): run missions in a `git worktree` so a dirty tree is
  // irrelevant instead of fatal.
  const dirty = git(entry.path, ['status', '--porcelain'])
  if (!dirty.ok) return { ok: false, error: `git status failed in ${entry.slug}: ${dirty.stderr.trim()}` }
  if (dirty.stdout.trim()) {
    return {
      ok: false,
      error: `repo "${entry.slug}" has uncommitted changes; mission refused — commit or stash them, then re-run`,
    }
  }

  // Fetch is best-effort: a flaky network must not sink the mission.
  const fetched = git(entry.path, ['fetch', 'origin'])
  if (!fetched.ok) console.warn(`[worker/poll] git fetch origin failed in ${entry.slug}: ${fetched.stderr.trim()}`)

  if (git(entry.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok) {
    const reuse = git(entry.path, ['checkout', branch])
    return reuse.ok ? { ok: true } : { ok: false, error: `git checkout ${branch} failed: ${reuse.stderr.trim()}` }
  }

  const fromRemote = git(entry.path, ['checkout', '-b', branch, `origin/${entry.defaultBranch}`])
  if (fromRemote.ok) return { ok: true }
  const fromLocal = git(entry.path, ['checkout', '-b', branch, entry.defaultBranch])
  if (fromLocal.ok) return { ok: true }

  return {
    ok: false,
    error: `git checkout -b ${branch} failed: ${fromRemote.stderr.trim() || fromLocal.stderr.trim()}`,
  }
}

// Leaves the checkout on its default branch. The aeon/* branch is never
// deleted — it holds the mission's work.
function restoreBranch(entry: RepoEntry): void {
  const res = git(entry.path, ['checkout', entry.defaultBranch])
  if (!res.ok) console.warn(`[worker/poll] could not restore ${entry.slug} to ${entry.defaultBranch}: ${res.stderr.trim()}`)
}

// ── prompt + envelope ────────────────────────────────────────────────────

function briefFileFor(sessionId: string): string {
  return join(tmpdir(), `aeon-hangar-${sessionId}-brief.md`)
}

// One line, no shell metacharacters: everything substantive lives in the file.
function briefPointer(entry: RepoEntry, branch: string, meta: HangarMeta, briefFile: string): string {
  const objective = (meta.objective ?? 'implement').replace(/[^a-z_]/gi, '')
  return `Aeon Hangar mission (${objective}) in repo ${entry.slug} on branch ${branch}. `
    + `Read the mission brief at ${briefFile.replace(/\\/g, '/')} first — it holds the request, `
    + `the context ids and the result envelope you must end your final message with — then execute it.`
}

function hangarMeta(session: ClaimedSession): HangarMeta {
  const meta = session.metadata as { hangar?: HangarMeta } | null | undefined
  return meta?.hangar ?? {}
}

function buildDispatchPrompt(
  session: ClaimedSession,
  entry: RepoEntry,
  branch: string,
  meta: HangarMeta,
): string {
  const lines: Array<string | null> = [
    `You are running an Aeon AI Hangar mission in repo "${entry.slug}" on branch ${branch}.`,
    `Objective: ${meta.objective ?? 'implement'}`,
    session.goal ? `Mission: ${session.goal}` : null,
    '',
    'Request:',
    meta.instruction ?? session.goal ?? '(no instruction supplied)',
    '',
    `Aeon session id: ${session.id}`,
    session.taskId
      ? `Aeon task id: ${session.taskId} — use the aeon MCP (get_task_detail) for full card context.`
      : null,
    meta.subagents?.length ? `Preferred subagents: ${meta.subagents.join(', ')}.` : null,
    `Output mode: ${meta.outputMode ?? 'auto'} — derive the deliverable from the objective.`,
    'Read the repo instructions (CLAUDE.md / AGENTS.md) before acting.',
    '',
    'Finish by ending your final message with a fenced json result envelope:',
    '```json',
    '{"status":"completed|needs_input|failed","outcome":"...","summary":"...","branch":null,"commit":null,"artifacts":[],"tests":{"status":"not_run"},"questions":[],"recommended_tasks":[]}',
    '```',
  ]
  return lines.filter((line): line is string => line !== null).join('\n')
}

function readEnvelope(
  engine: EngineAdapter,
  stdout: string,
  outFile: string | null,
): Record<string, unknown> | null {
  if (engine.envelopeSource === 'file' && outFile && existsSync(outFile)) {
    try {
      // Same decode as the stdout path: codex writes JSONL to -o, so the
      // fenced block is escaped inside a "text" field rather than sitting
      // in the file plain.
      const text = readFileSync(outFile, 'utf8')
      const fromFile = extractEnvelope(collectText(text)) ?? tryParse(text)
      if (fromFile) return fromFile
    } catch (err) {
      console.error('[worker/poll] could not read engine output file', err)
    }
  }
  return extractEnvelope(collectText(stdout))
}
