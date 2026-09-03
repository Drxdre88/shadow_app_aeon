// AI Hangar pull dispatch. Instead of Aeon pushing /spawn at the worker, the
// worker polls Aeon, claims a queued session, creates a disposable mission
// worktree, shells the engine inside it, streams the transcript back and posts
// the terminal result envelope. NAT-friendly: nothing has to reach this host.
// The operator's live checkout is never branch-switched — missions and manual
// work coexist, and N worktrees give N conflict-free paths (path-exclusive
// concurrency, Archon lane 3).
//
// Push mode is untouched — a poll-mode session never goes through /spawn.

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
import {
  createWorktree,
  deleteBranchIfEmpty,
  isMissionBranch,
  MISSION_BRANCH_PREFIX,
  missionCommits,
  pushBranch,
  removeWorktree,
  worktreeDirFor,
} from './worktree.js'
import { exec, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { jsonbSafeChunks, sanitizeJsonbDeep } from './stream-parser.js'
import type { MissionStats, StreamParser } from './stream-parser.js'

const execAsync = promisify(exec)

// A malformed value ("two", "") must degrade to the default, never to NaN —
// `activeCount < NaN` is false and the runner would silently claim nothing.
function envInt(name: string, fallback: number, min: number): number {
  const n = Math.trunc(Number(process.env[name]))
  return Number.isFinite(n) && n >= min ? n : fallback
}

const POLL_INTERVAL_MS = envInt('KAIROS_POLL_INTERVAL_MS', 15000, 1000)
const HEARTBEAT_MS = envInt('KAIROS_HEARTBEAT_MS', 30000, 1000)
const MAX_CONCURRENT = envInt('KAIROS_MAX_CONCURRENT', 1, 1)

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

// The charset check above says nothing about WHICH branch: a card supplying
// `feat/flight-deck` passes it, and the mission would then be `worktree
// add`-ed onto the operator's own branch, committed to by the agent and PUSHED
// by teardown. Only the mission namespace is dispatchable.
export function outsideMissionNamespace(branch: string): string | null {
  if (isMissionBranch(branch)) return null
  return `branch "${branch}" is outside the ${MISSION_BRANCH_PREFIX} mission namespace — mission refused `
    + `so a mission can never commit to or push an operator branch; `
    + `leave the branch field blank to get the generated ${MISSION_BRANCH_PREFIX}<card> name`
}

// killSession only SIGTERMs / taskkills the tree — it does not wait. The child
// holds open handles INSIDE the mission worktree and teardown deletes that
// tree, so on Windows the delete fails while the process is still alive.
// Bounded: a wedged child must not hold the mission slot open forever, and
// teardown already surfaces a failed removal as a warning on the card.
const CHILD_EXIT_GRACE_MS = 10_000

export function waitForExit(child: ChildProcess | null, timeoutMs = CHILD_EXIT_GRACE_MS): Promise<boolean> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise<boolean>((done) => {
    let finished = false
    const onClose = (): void => finish(true)
    const finish = (exited: boolean): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      child.off('close', onClose)
      done(exited)
    }
    const timer = setTimeout(() => {
      console.warn(`[worker/poll] child pid ${child.pid ?? '?'} did not exit within ${timeoutMs}ms — proceeding with teardown`)
      finish(false)
    }, timeoutMs)
    child.once('close', onClose)
  })
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
// Claims drain to capacity in one tick so five queued cards start together
// instead of one per poll interval — bounded per tick so a queue of
// fast-failing sessions cannot burn the write budget in one synchronous burst.
async function tick(): Promise<void> {
  try {
    for (let i = 0; i < MAX_CONCURRENT && activeCount < MAX_CONCURRENT; i++) {
      const claimed = await claimOnce()
      if (!claimed) break
    }
  } catch (err) {
    console.error('[worker/poll] tick failed', err)
  } finally {
    setTimeout(() => void tick(), POLL_INTERVAL_MS)
  }
}

async function claimOnce(): Promise<boolean> {
  lastPollAt = new Date().toISOString()

  const res = await aeonFetch<{ session: ClaimedSession | null }>(
    AEON_BASE_URL,
    AEON_API_KEY,
    '/api/v1/sessions/claim',
    { method: 'POST', body: { workerId, engines: engineIds() } },
  )
  if (!res.ok) {
    if (res.status) console.error(`[worker/poll] claim rejected (${res.status})`)
    return false
  }

  const session = res.data?.session ?? null
  if (!session) return false

  activeCount++
  console.log(`[worker/poll] claimed ${session.id} engine=${session.engine} repo=${session.repo}`)
  // Not awaited: launch can legitimately take minutes (worktree add on a big
  // repo, envSetupCmd), and awaiting it here would freeze claiming for every
  // other repo. activeCount is already up, so capacity stays correct; launch
  // handles its own failures and release() is its every exit path.
  void launch(session).catch((err) => console.error(`[worker/poll] launch escaped for ${session.id}`, err))
  return true
}

async function launch(session: ClaimedSession): Promise<void> {
  const ctx = pollContext(session.id)
  const nextSeq = createSeq(1)

  // Set once the mission worktree exists / the brief is on disk / the child is
  // running, so an abort tears down everything it created and nothing it
  // didn't — including killing a child that already started.
  let mission: { entry: RepoEntry; branch: string; startSha: string } | null = null
  let brief: string | null = null
  let childRunning = false
  // Hoisted so abort() can reach them: an abort that leaves the heartbeat
  // beating keeps polling Aeon for a mission that is already over, and one
  // that deletes the worktree while the child still holds handles inside it
  // leaves debris that blocks the next run of the card.
  let child: ChildProcess | null = null
  let stopHeartbeat: () => void = () => {}
  // Shared with the child's terminal handlers: whoever sets it first owns the
  // terminal sequence, so abort and a racing 'error'/'close' cannot both run.
  let settled = false

  let released = false
  const release = (): void => {
    if (released) return
    released = true
    activeCount--
    releaseSession(session.id)
  }

  const abort = async (message: string): Promise<void> => {
    if (settled) return // a terminal handler already owns the sequence
    settled = true
    console.error(`[worker/poll] ${session.id} ${message}`)
    stopHeartbeat()
    if (childRunning) killSession(session.id)
    try {
      await postEvent(ctx, { seq: nextSeq(), kind: 'error', payload: { message } })
      await patchSession(ctx, { status: 'failed', endedAt: new Date().toISOString() })
      if (brief) rmSync(brief, { force: true })
      // The kill above is fire-and-forget — teardown's recursive delete only
      // runs once the child has actually let go of the worktree.
      if (childRunning) await waitForExit(child)
      if (mission) await teardownWorktree(mission.entry, mission.branch, mission.startSha)
    } catch (cleanupErr) {
      console.error(`[worker/poll] ${session.id} abort cleanup failed`, cleanupErr)
    } finally {
      release()
    }
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

    const branch = session.branch?.trim() || `${MISSION_BRANCH_PREFIX}${(session.taskId ?? session.id).slice(0, 8)}`
    const meta = hangarMeta(session)
    const rejected = unsafeArg('branch', branch)
      ?? outsideMissionNamespace(branch)
      ?? unsafeArg('model', meta.model)
      ?? unsafeArg('session id', session.id)
    if (rejected) return await abort(rejected)

    const tree = await createWorktree(entry, branch)
    if (!tree.ok) return await abort(tree.error)
    mission = { entry, branch, startSha: tree.startSha }
    const workPath = tree.path

    if (entry.envSetupCmd) {
      try {
        await execAsync(entry.envSetupCmd, { cwd: workPath, windowsHide: true, timeout: 600_000 })
      } catch (err) {
        return await abort(`envSetupCmd failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

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

    const args = engine.buildArgs(prompt, { model: meta.model ?? null, cwd: workPath, outFile })
    console.log(`[worker/poll] ${session.id} → ${engine.bin} in ${workPath} on ${branch}`)

    const parser = engine.streamParser?.() ?? null

    const handle = runEngine({
      sessionId: session.id,
      ctx,
      bin: engine.bin,
      args,
      cwd: workPath,
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

    // Everything between spawn and handler attachment stays SYNCHRONOUS: a
    // spawn failure is delivered on the next tick, so the first `await` before
    // the 'error' listener exists would turn it into an uncaught exception
    // that kills the whole runner and orphans every in-flight mission.
    childRunning = true
    child = handle.child

    stopHeartbeat = startHeartbeat(session.id, () => {
      killSession(session.id)
    })

    // One terminal owner only: a failed spawn emits 'error' AND 'close', and
    // an abort can race both — the shared synchronous `settled` flag admits
    // exactly one terminal sequence.
    handle.child.on('error', (err) => {
      if (settled) return
      settled = true
      childRunning = false
      stopHeartbeat()
      void (async () => {
        try {
          await postEvent(ctx, { seq: nextSeq(), kind: 'error', payload: { message: err.message } })
          await patchSession(ctx, { status: 'failed', endedAt: new Date().toISOString() })
          rmSync(briefFile, { force: true })
          await teardownWorktree(entry, branch, tree.startSha)
        } catch (cleanupErr) {
          console.error(`[worker/poll] ${session.id} error-path cleanup failed`, cleanupErr)
        } finally {
          release()
        }
      })()
    })

    // 'close', not 'exit': 'exit' fires while stdio is still draining, so the
    // envelope sitting in the last stdout chunk would be missing and a
    // successful mission would be reported as failed.
    handle.child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      childRunning = false
      stopHeartbeat()
      void finalize({
        ctx,
        nextSeq,
        engine,
        entry,
        branch,
        startSha: tree.startSha,
        outFile,
        briefFile,
        code,
        signal,
        killed: handle.killed(),
        stdout: handle.captured(),
        parser,
        release,
      }).catch((err) => {
        // finalize is written not to throw, but a slot leak is the one
        // failure this runner must never have — belt and braces.
        console.error(`[worker/poll] ${session.id} finalize escaped`, err)
        release()
      })
    })

    // First await only now that both terminal handlers exist. If this PATCH
    // throws, abort() kills the child and the settled flag keeps the close
    // handler from double-finalizing.
    await patchSession(ctx, {
      status: 'running',
      workerHost: hostname(),
      workerPid: handle.child.pid ?? null,
      startedAt: new Date().toISOString(),
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
  branch: string
  startSha: string
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
// Same untrusted-parser rule as the stream path in spawner.ts: stats() runs on
// state the parser built from engine output, and a throw here would cost the
// mission both its result envelope and its worktree teardown.
export function safeStats(parser: StreamParser | null): MissionStats | null {
  if (!parser) return null
  try {
    return parser.stats()
  } catch (err) {
    console.error('[worker/poll] stream parser stats() threw — reporting the mission without telemetry', err)
    return null
  }
}

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

// A blind stdout.slice(-2000) is the one thing that can lose the result
// envelope — the write a mission cannot afford to lose. A NUL byte, or a slice
// that opens on the low half of a surrogate pair, makes Postgres reject the
// whole jsonb payload as a non-retriable 400. Chunking the FULL stdout runs
// the same redaction + NUL strip the telemetry path uses and never splits a
// pair at a chunk edge; the deep sanitizer then replaces any surrogate that
// was already lone in the engine's own output.
export function rawTail(stdout: string, limit = 2000): string {
  const chunks = jsonbSafeChunks(stdout, limit)
  const tail = chunks.slice(-2).join('').slice(-limit)
  return sanitizeJsonbDeep(tail) as string
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
  const { ctx, nextSeq, engine, entry, branch, startSha, outFile, briefFile, code, signal, killed, stdout, parser, release } = args
  try {
    await finalizeInner(args)
  } finally {
    // The slot must free on EVERY path — an unreleased slot is a permanent
    // capacity leak the log would never explain.
    release()
  }
}

async function finalizeInner(args: FinalizeArgs): Promise<void> {
  const { ctx, nextSeq, engine, entry, branch, startSha, outFile, briefFile, code, signal, killed, stdout, parser } = args
  const endedAt = new Date().toISOString()
  const wasKilled = killed || signal === 'SIGTERM'

  await postEvent(ctx, { seq: nextSeq(), kind: 'stop', payload: { exitCode: code, signal } })

  const envelope = normalizeEnvelope(readEnvelope(engine, stdout, outFile))
  const stats = missionStats(safeStats(parser))

  // The result event and the final status are the two writes that must land:
  // losing either leaves a finished mission showing as 'running' on the board.
  const base = envelope ?? {
    status: 'failed',
    outcome: 'blocked',
    summary: 'engine exited without a result envelope',
    raw_tail: rawTail(stdout),
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

  // Publish-or-vanish teardown: a productive branch is pushed before its
  // worktree goes, so the work survives the disposable checkout; an empty one
  // leaves no litter. The events make the outcome visible on the card.
  const shipped = await teardownWorktree(entry, branch, startSha)
  if (shipped.ahead > 0) {
    const message = shipped.pushed
      ? `branch ${branch} pushed to origin (${shipped.ahead} commit${shipped.ahead === 1 ? '' : 's'})`
      : `branch ${branch} has ${shipped.ahead} commit(s) but push failed: ${shipped.error ?? 'unknown'} — it survives locally`
    await postEvent(ctx, { seq: nextSeq(), kind: 'system', payload: { subtype: 'branch', message } })
  }
  if (shipped.depsMutated) {
    await postEvent(ctx, {
      seq: nextSeq(),
      kind: 'system',
      payload: {
        subtype: 'warning',
        message: 'mission replaced a shared dependency dir (junction gone) — dependencies are shared with the live checkout and must not be installed in-mission',
      },
    })
  }
  if (!shipped.removed) {
    // The destroy safety valve refused (a link survived) or deletion failed —
    // without this event the next run of the card dies at the "already
    // exists" refusal with no context anywhere the operator looks.
    await postEvent(ctx, {
      seq: nextSeq(),
      kind: 'system',
      payload: { subtype: 'warning', message: `mission worktree could not be removed — manual sweep needed: ${shipped.path}` },
    })
  }
}

// Push-if-productive: count only the commits THIS mission added (from the tip
// captured at worktree creation), push when there is work, always remove the
// worktree, and drop the branch only when it holds nothing anywhere. Never
// pushes or deletes the repo default branch.
interface TeardownReport {
  pushed: boolean
  ahead: number
  error: string | null
  depsMutated: boolean
  removed: boolean
  path: string
}

// NEVER throws: the repo-lock timebox rejects on a wedged git op, and every
// caller (finalize, abort, the 'error' handler) treats teardown as the last
// step before release() — a throw here would either kill the runner as an
// unhandled rejection or silently leak an activeCount slot. Failure routes
// through removed:false, which finalize surfaces as a warning on the card.
async function teardownWorktree(
  entry: RepoEntry,
  branch: string,
  startSha: string | null,
): Promise<TeardownReport> {
  try {
    const ahead = branch === entry.defaultBranch ? 0 : await missionCommits(entry, branch, startSha)
    let pushed = false
    let error: string | null = null
    if (ahead > 0) {
      const res = await pushBranch(entry, branch)
      pushed = res.ok
      if (!res.ok) {
        error = res.stderr.trim()
        console.warn(`[worker/poll] push ${branch} failed: ${error}`)
      }
    }
    const destroyed = await removeWorktree(entry, branch)
    if (ahead === 0) await deleteBranchIfEmpty(entry, branch)
    return { pushed, ahead, error, depsMutated: destroyed.depsMutated, removed: destroyed.removed, path: destroyed.path }
  } catch (err) {
    console.error(`[worker/poll] teardown failed for ${branch}`, err)
    return {
      pushed: false,
      ahead: 0,
      error: err instanceof Error ? err.message : String(err),
      depsMutated: false,
      removed: false,
      path: worktreeDirFor(entry, branch),
    }
  }
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
    'Do NOT install, update or remove dependencies (node_modules is shared with the live checkout via a junction).',
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
