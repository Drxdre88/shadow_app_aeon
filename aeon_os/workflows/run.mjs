#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, cpSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { listCopilotModels } from './probe-copilot-models.mjs'
import { archiveDecision, evaluateReviewGate, importVerdict, loadVerdicts, reviewConfig, reviewsDir, runReview } from './review.mjs'
import { assertCitationFloor, extractCitations } from './review-bundle.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const RUNTIME = join(HERE, '.runtime')
const STATE_FILE = join(RUNTIME, 'state.json')
const RESULTS = join(HERE, 'results')
const BOOTSTRAP_FILE = join(HERE, 'bootstrap.json')
const ENV_FILE = join(ROOT, 'apps', 'kairos-worker', 'runner.env.bat')
const WORKER_ENTRY = join(ROOT, 'apps', 'kairos-worker', 'src', 'index.ts')
const PORT = 8799
const TERMINAL = new Set(['succeeded', 'failed', 'killed', 'timeout'])
const TOPICS = [
  ['session claim ownership', 'apps/web/src/lib/data/sessions.ts and its focused claim tests'],
  ['result envelope parsing', 'apps/kairos-worker/src/envelope.ts and its focused tests'],
  ['mission worktree retention', 'apps/kairos-worker/src/worktree.ts and its focused tests'],
  ['Hangar launch editor', 'apps/web/src/components/board/MissionEditorModal.tsx and focused component tests'],
  ['auto-drop launch behavior', 'apps/web/src/components/board/autoRun.ts plus useBoardDnD auto-run tests'],
  ['mission cancellation', 'session kill routes/actions and worker cancellation paths'],
  ['runner repository registry', 'apps/kairos-worker/src/registry.ts and its focused tests'],
  ['Flight Deck telemetry', 'apps/kairos-worker/src/stream-parser.ts and timeline consumers'],
  ['terminal result retries', 'apps/kairos-worker/src/callback.ts and poller finalization'],
  ['engine model arguments', 'apps/kairos-worker/src/engines.ts and its focused tests'],
]

function help() {
  console.log(`Aeon OS production workflow proof\n\nUsage:\n  node aeon_os/workflows/run.mjs preflight\n  node aeon_os/workflows/run.mjs prepare\n  node aeon_os/workflows/run.mjs prepare --new\n  node aeon_os/workflows/run.mjs run --count=1\n  node aeon_os/workflows/run.mjs run --count=10\n  node aeon_os/workflows/run.mjs review [--attempt=N] [--allow-same-model]\n  node aeon_os/workflows/run.mjs review --import <verdict.json> --attempt=N [--force]\n  node aeon_os/workflows/run.mjs status\n  node aeon_os/workflows/run.mjs stop\n\nMechanical validation alone only reaches review_pending. A run reaches\npassed only once every attempt carries an independent review verdict of\nexactly PASS; any PASS_WITH_CORRECTIONS or FAIL ends the run failed.\n\nThe default invocation is read-only and prints this help.`)
}

function parseEnv() {
  const allowed = new Set(['AEON_BASE_URL', 'KAIROS_AEON_API_KEY', 'KAIROS_COPILOT_DEFAULT_MODEL'])
  const parsed = {}
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const match = /^\s*set\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/i.exec(line)
      if (match && allowed.has(match[1].toUpperCase())) parsed[match[1].toUpperCase()] = match[2].trim()
    }
  }
  const cfg = {
    baseUrl: (process.env.AEON_BASE_URL || parsed.AEON_BASE_URL || '').replace(/\/$/, ''),
    apiKey: process.env.KAIROS_AEON_API_KEY || parsed.KAIROS_AEON_API_KEY || '',
    model: process.env.KAIROS_COPILOT_DEFAULT_MODEL || parsed.KAIROS_COPILOT_DEFAULT_MODEL || '',
  }
  if (!cfg.baseUrl || !/^https:\/\//i.test(cfg.baseUrl)) throw new Error('AEON_BASE_URL must be an https URL')
  if (!cfg.apiKey) throw new Error('KAIROS_AEON_API_KEY is missing')
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(cfg.model)) throw new Error('KAIROS_COPILOT_DEFAULT_MODEL is missing or unsafe')
  return cfg
}

function runRaw(command, args, opts = {}) {
  const out = spawnSync(command, args, { cwd: opts.cwd ?? ROOT, encoding: 'utf8', windowsHide: true, timeout: opts.timeout ?? 120_000 })
  if (out.error || out.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${(out.stderr || out.error?.message || '').trim()}`)
  return out.stdout || ''
}
function run(command, args, opts = {}) { return runRaw(command, args, opts).trim() }

// Working-tree git only. A BARE repo (the run's origin.git) must always be
// addressed with `--git-dir`, never `-C`: hardened environments set
// safe.bareRepository=explicit — Copilot CLI injects exactly that via
// GIT_CONFIG_KEY_* — and git then refuses `-C <bare>` outright. That made
// waitForDelivery read no SHA at all and report "publication did not settle"
// for a branch that had in fact been pushed (measured 2026-09-11).
function git(cwd, ...args) { return run('git', args, { cwd }) }
function now() { return new Date().toISOString() }
function sleep(ms) { return new Promise((done) => setTimeout(done, ms)) }
function save(state) { mkdirSync(RUNTIME, { recursive: true }); writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`) }
function load() { if (!existsSync(STATE_FILE)) throw new Error('No prepared run. Run prepare first.'); return JSON.parse(readFileSync(STATE_FILE, 'utf8')) }
function resultDir(state) { return join(RESULTS, state.runId) }
function persist(state, name, value) { const dir = resultDir(state); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`) }
function readBootstrap() {
  if (!existsSync(BOOTSTRAP_FILE)) throw new Error('bootstrap.json is missing; the review gate reads its reviewer engine and model from it')
  return JSON.parse(readFileSync(BOOTSTRAP_FILE, 'utf8'))
}

// The gate, in one place. Mechanical validation can only carry a run as far as
// review_pending; the terminal state is decided by the stored verdicts alone,
// so a run can never reach `passed` on plumbing evidence.
function applyGate(state) {
  const gate = evaluateReviewGate({ attempts: state.attempts, verdicts: loadVerdicts(resultDir(state)) })
  state.review = gate
  state.status = gate.status
  if (gate.outcome === 'review_failed') state.failureKind = 'review'
  else delete state.failureKind
  return gate
}

// A run that finished before this gate existed keeps its own verdict. Its
// receipt is immutable: it is displayed as legacy, never retro-marked.
const TERMINAL_STATUSES = ['passed', 'failed', 'partial_pass']
function legacyGate(state) {
  // Only a run that actually finished before the gate existed is legacy. A
  // freshly prepared run has no reviews directory either, and calling that
  // legacy would hide the fact that its review has not started.
  if (!TERMINAL_STATUSES.includes(state.status)) return false
  if (!Array.isArray(state.attempts) || state.attempts.length === 0) return false
  return state.review === undefined && !existsSync(reviewsDir(resultDir(state)))
}

function runRecord(state, cfg, extra = {}) {
  return {
    runId: state.runId,
    status: state.status,
    createdAt: state.createdAt,
    updatedAt: now(),
    sourceBranch: state.sourceBranch,
    baseSha: state.baseSha,
    projectId: state.projectId,
    requestedEngine: 'copilot',
    requestedModel: cfg?.model ?? state.attempts.at(-1)?.model ?? null,
    missionCredits: state.missionCredits ?? null,
    mechanical: state.mechanical ?? null,
    review: state.review ?? null,
    attempts: state.attempts,
    uiLaunchWrapperExercised: false,
    ...extra,
  }
}

function unwrap(body) { return body && typeof body === 'object' && Object.hasOwn(body, 'data') ? body.data : body }

async function api(cfg, path, init = {}) {
  const method = init.method ?? 'GET'
  // GET only. A POST may have been delivered with its response lost, so
  // replaying it could create a second paid session; callers that need it
  // reconcile a lost create against the session list instead.
  const retries = method === 'GET' ? [2_000, 5_000, 10_000] : []
  for (let attempt = 0; ; attempt++) {
    let response
    try {
      response = await fetch(`${cfg.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err) {
      // A transport failure never reached the server, so replaying a read is
      // safe — and not replaying it is fatal to the whole exercise. One
      // attempt polls roughly every 15s for up to 8 minutes, so a ten-job
      // batch makes hundreds of calls: without this, a single DNS/TLS hiccup
      // discards every mission already paid for. Measured 2026-09-11: run
      // 2026-09-11T11-58-24-419Z-0595ae delivered its report and its session
      // reached `succeeded` in production, yet the batch was recorded FAIL
      // because one poll threw "fetch failed".
      if (attempt < retries.length) { await sleep(retries[attempt]); continue }
      throw new Error(`${method} ${path} failed before an HTTP response: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (response.ok) return unwrap(await response.json())
    // 429 and 5xx are the same transient class as a dropped connection: the
    // edge is unhealthy, not the mission.
    if ((response.status === 429 || response.status >= 500) && attempt < retries.length) { await sleep(retries[attempt]); continue }
    if (response.status === 401 || response.status === 403) throw new Error(`${method} ${path} returned ${response.status}; response body withheld`)
    let message = ''
    try { message = (await response.json())?.error ?? '' } catch { /* no safe detail */ }
    throw new Error(`${method} ${path} returned ${response.status}${message ? `: ${message}` : ''}`)
  }
}

async function listSessions(cfg) {
  const all = []
  for (let offset = 0; ; offset += 100) {
    const page = await api(cfg, `/api/v1/sessions?limit=100&offset=${offset}`)
    const rows = page?.sessions ?? []
    all.push(...rows)
    if (rows.length < 100) return all
  }
}

async function assertNoLiveCardSessions(cfg, ownId = null) {
  const conflict = (await listSessions(cfg)).find((s) => s.taskId && ['queued', 'running'].includes(s.status) && s.id !== ownId)
  if (conflict) throw new Error(`card-linked session ${conflict.id} is already ${conflict.status}; refusing to let this isolated runner claim it`)
}

function executable(name) {
  const lines = run('where.exe', [name]).split(/\r?\n/).filter(Boolean)
  return lines.find((p) => p.toLowerCase().endsWith('.exe')) ?? lines[0]
}

async function portAvailable(port) {
  return new Promise((done) => {
    const server = createServer()
    server.once('error', () => done(false))
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)))
  })
}

async function preflight() {
  const cfg = parseEnv()
  await verifyModel(cfg)
  const sessions = await listSessions(cfg)
  const liveCardSessions = sessions.filter((s) => s.taskId && ['queued', 'running'].includes(s.status))
  const modelHelp = run(executable('copilot'), ['--help'], { timeout: 30_000 })
  if (!modelHelp.includes('--max-ai-credits')) throw new Error('installed Copilot CLI does not support --max-ai-credits')
  executable('git'); executable('node')
  if (!(await portAvailable(PORT))) throw new Error(`port ${PORT} is already in use`)
  console.log(JSON.stringify({ ok: true, baseUrl: cfg.baseUrl, model: cfg.model, engine: 'copilot', workerPort: PORT, liveCardSessions: liveCardSessions.length, writes: 0 }, null, 2))
  if (liveCardSessions.length) throw new Error('preflight found live card-linked sessions; wait or stop them before this isolated proof')
}

async function verifyModel(cfg) {
  const models = await listCopilotModels(executable('copilot'))
  if (!models.some(model => model.id === cfg.model)) throw new Error(`Copilot model ${cfg.model} is not available to this account; run probe-copilot-models.mjs to list valid IDs`)
  return models
}

async function prepare(fresh = false) {
  if (existsSync(STATE_FILE)) {
    const prior = load()
    if (!fresh) { console.log(`Run ${prior.runId} is already prepared; reusing its isolated origin and Aeon project.`); return }
    // review_pending and partial_pass are normal end states of the review
    // gate, so an operator who abandons a run must not have to hand-edit
    // state.json to start the next one.
    const decision = archiveDecision(prior.status)
    if (!decision.allowed) throw new Error(`run ${prior.runId} is ${prior.status}; only a failed, completed, partially passed or review-pending run can be archived`)
    persist(prior, 'archived-state.json', { ...prior, archivedAt: now(), abandoned: decision.abandoned })
    if (decision.abandoned) {
      // Stamp the receipt so it can never be mistaken for a reviewed run.
      const abandonedAt = now()
      prior.review = evaluateReviewGate({ attempts: prior.attempts, verdicts: loadVerdicts(resultDir(prior)) })
      persist(prior, 'run.json', { ...runRecord(prior, null), abandoned: true, abandonedAt, note: `archived by prepare --new while ${prior.review.reviewed}/${prior.review.total} attempt(s) were reviewed; this run was never fully reviewed and is not a pass` })
    }
  }
  const cfg = parseEnv()
  await assertNoLiveCardSessions(cfg)
  const sourceBranch = git(ROOT, 'branch', '--show-current')
  if (!sourceBranch) throw new Error('source checkout is detached')
  const baseSha = git(ROOT, 'rev-parse', 'HEAD')
  const runId = `${now().replace(/[:.]/g, '-').replace('Z', 'Z')}-${randomBytes(3).toString('hex')}`
  const runRoot = join(RUNTIME, 'runs', runId)
  const originPath = join(runRoot, 'origin.git')
  const clonePath = join(runRoot, 'source')
  const registryPath = join(runRoot, 'repos.json')
  mkdirSync(runRoot, { recursive: true })
  run('git', ['clone', '--bare', '--single-branch', '--branch', sourceBranch, '--no-hardlinks', ROOT, originPath], { timeout: 300_000 })
  run('git', ['clone', originPath, clonePath], { timeout: 300_000 })
  git(clonePath, 'config', 'core.longpaths', 'true')
  cpSync(join(ROOT, 'CLAUDE.md'), join(clonePath, 'CLAUDE.md'))
  writeFileSync(registryPath, `${JSON.stringify({ repos: { 'aeon-os-test': { path: clonePath, defaultBranch: sourceBranch, envSetupCmd: null, link: '', copy: 'CLAUDE.md' } } }, null, 2)}\n`)
  const state = { version: 1, runId, createdAt: now(), sourceBranch, baseSha, originPath, clonePath, registryPath, projectId: null, columns: {}, attempts: [], worker: null, status: 'preparing' }
  save(state)
  let project
  if (existsSync(BOOTSTRAP_FILE)) {
    const bootstrap = JSON.parse(readFileSync(BOOTSTRAP_FILE, 'utf8'))
    if (!bootstrap.projectId || (bootstrap.baseUrl && bootstrap.baseUrl.replace(/\/$/, '') !== cfg.baseUrl)) throw new Error('bootstrap.json does not match the configured production Aeon API')
    project = await api(cfg, `/api/v1/projects/${bootstrap.projectId}`)
  } else {
    const day = new Date().toISOString().slice(0, 10)
    const end = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
    project = await api(cfg, '/api/v1/projects', { method: 'POST', body: { name: `Aeon OS E2E ${runId.slice(0, 19)}`, description: `Controlled production workflow proof ${runId}. Local isolated Git origin; research reports only.`, startDate: day, endDate: end, timeScale: 'week' } })
  }
  state.projectId = project.id; save(state)
  await api(cfg, `/api/v1/projects/${project.id}`, { method: 'PUT', body: { settings: { boardMode: 'hangar' } } })
  const existingColumns = await api(cfg, `/api/v1/projects/${project.id}/columns`)
  for (const [index, name] of ['Queued', 'Flight', 'Landing', 'Tower'].entries()) {
    const matches = existingColumns.filter((column) => column.name?.trim().toLowerCase() === name.toLowerCase())
    if (matches.length > 1) throw new Error(`project has duplicate ${name} columns`)
    const column = matches[0] ?? await api(cfg, `/api/v1/projects/${project.id}/columns`, { method: 'POST', body: { name, color: ['purple', 'blue', 'green', 'orange'][index], orderIndex: index } })
    state.columns[name] = column.id; save(state)
  }
  state.status = 'prepared'; save(state)
  persist(state, 'run.json', { ...state, originPath: relative(ROOT, state.originPath), clonePath: relative(ROOT, state.clonePath), registryPath: relative(ROOT, state.registryPath) })
  console.log(`Prepared ${runId}: isolated origin, production project ${project.id}, and four Hangar columns.`)
}

function missionPrompt(state, index, taskId) {
  const [topic, scope] = TOPICS[index]
  const marker = `AEON_OS_E2E_${state.runId}_${String(index + 1).padStart(2, '0')}`
  const report = `aeon_os/workflows/reports/${state.runId}-${String(index + 1).padStart(2, '0')}.md`
  const branch = `aeon/${taskId.slice(0, 8)}`
  const envelope = JSON.stringify({ status: 'completed', outcome: 'investigation_complete', summary: `${marker}: completed bounded repository research and committed the report.`, branch, commit: 'REPLACE_WITH_FULL_40_CHARACTER_HEAD_SHA', artifacts: [report], tests: { status: 'not_run', summary: 'Repository research only; no tests requested or run.' }, questions: [], recommended_tasks: [] }, null, 2)
  return { marker, report, text: `Controlled Aeon OS repository research mission. Unique marker: ${marker}\n\nResearch only this bounded subsystem: ${topic}. Primary scope: ${scope}. Produce exactly one durable report at ${report}. The report must contain the unique marker and at least three concrete, independently useful findings, each citing an existing repository source as path:line. Write EVERY citation as a full repository-root-relative path, for example apps/web/src/lib/data/sessions.ts:150 — never a bare filename such as sessions.ts:150, and never abbreviate on repeat mentions of a file you already cited in full. Every line number must point at the exact statement, declaration or assertion your finding describes — not a comment above it, a test title, or a nearby line. Never cite from memory or by counting: take every line number from a numbered listing of the file (for example grep -n, or sed -n with line numbers) and, immediately before writing the report, re-run that numbered listing for each cited file and confirm every path:line points at the exact text you quote; a predicate on the line after the one you cite is a wrong citation. State what the cited lines do; never assert what code elsewhere does not do (no "not in a prior read", "never called", "no test covers"). An independent reviewer will open every citation at this exact revision and fail the report on a single wrong line. The reviewer sees ONLY the cited lines, so a finding must be fully evidenced by the lines it cites: cite every line that carries the mechanism you describe (a loop AND the assignment inside it, an import AND the call). Label each finding Observed (the cited lines show it) or Inference (a conclusion you drew from them), never claim that nothing was inferred, and do not present a security, concurrency or coverage guarantee as observed when the lines only show a predicate. Do not build a numbered finding on the absence of something (never tested, never called, never imported): a search result cannot be verified from cited lines and will fail review; mention such absences only under a separate heading "Unverified observations" without a finding number. Distinguish observed code from inference.\n\nRepository research only. Do not change source code or any file except ${report}. Do not install dependencies, run tests, call external services, send messages, use Aeon MCP or change any board, invoke subagents, or invent an agent/person identity. You are explicitly authorized to create and commit ONLY that report on the already-created mission branch. Before committing, inspect git status and the staged diff and abort if any other path is staged or changed. Use one Conventional Commit with no coauthor or AI attribution. Do not run git push; the runner publishes to the isolated local origin.\n\nYour final response must end with exactly one fenced JSON result envelope. Use status completed only if the report is committed. Replace the commit placeholder below with the full 40-character HEAD SHA; preserve every other field and ensure summary is present.\n\n\`\`\`json\n${envelope}\n\`\`\`` }
}

function createBudgetWrapper(state) {
  const target = executable('copilot')
  const wrapper = join(dirname(state.registryPath), 'copilot-budget.cmd')
  if (/\r|\n|"/.test(target)) throw new Error('unsafe Copilot executable path')
  // The cap stays — it is the cost containment for a batch of real paid
  // missions — but 30 was under the observed requirement. Measured
  // 2026-09-11 across three production missions: two committed inside 30,
  // the third exhausted its budget with the report already written and only
  // the commit outstanding, so the work was destroyed by teardown (only
  // committed work is published). 60 restores headroom without uncapping.
  // 1709: the cap is per model class — claude-opus-5 spent 66.93 credits on
  // the same recon mission (15 premium requests) and was cut off mid-report,
  // so a heavier mission model needs AEON_OS_MISSION_CREDITS raised for the
  // run. The value is recorded in the run state so the receipt shows it.
  const credits = missionCredits()
  state.missionCredits = credits
  writeFileSync(wrapper, `@echo off\r\nset "KAIROS_AEON_API_KEY="\r\nset "AEON_API_KEY="\r\nset "KAIROS_CALLBACK_TOKEN="\r\nset "KAIROS_WORKER_SECRET="\r\nset "AEON_MCP_TOKEN="\r\n"${target}" --disable-mcp-server aeon --disable-mcp-server playwright --disable-builtin-mcps --max-ai-credits ${credits} %*\r\n`)
  return wrapper
}

const DEFAULT_MISSION_CREDITS = 60
const MAX_MISSION_CREDITS = 300

function missionCredits() {
  const raw = process.env.AEON_OS_MISSION_CREDITS
  if (raw === undefined || raw === '') return DEFAULT_MISSION_CREDITS
  if (!/^\d{1,3}$/.test(raw)) throw new Error(`AEON_OS_MISSION_CREDITS must be an integer between 30 and ${MAX_MISSION_CREDITS}`)
  const value = Number(raw)
  if (value < 30 || value > MAX_MISSION_CREDITS) throw new Error(`AEON_OS_MISSION_CREDITS must be an integer between 30 and ${MAX_MISSION_CREDITS}`)
  return value
}

function createOneClaimBootstrap(cfg, state, attempt) {
  const at = join(dirname(state.registryPath), 'one-claim-worker.mjs')
  const entryUrl = new URL(`file:///${WORKER_ENTRY.replace(/\\/g, '/')}`).href
  const origin = new URL(cfg.baseUrl).origin
  writeFileSync(at, `const realFetch = globalThis.fetch\nconst expected = ${JSON.stringify(attempt.sessionId)}\nlet claimed = false\nconst empty = () => new Response(JSON.stringify({ data: { session: null } }), { status: 200, headers: { 'Content-Type': 'application/json' } })\nglobalThis.fetch = async (input, init) => {\n  const url = new URL(typeof input === 'string' ? input : input.url)\n  const isClaim = url.origin === ${JSON.stringify(origin)} && url.pathname === '/api/v1/sessions/claim' && (init?.method ?? 'GET') === 'POST'\n  if (!isClaim) return realFetch(input, init)\n  if (claimed) return empty()\n  const response = await realFetch(input, init)\n  try {\n    const session = (await response.clone().json())?.data?.session\n    if (response.ok && session) {\n      claimed = true\n      if (session.id !== expected) {\n        console.error('[aeon-os/gate] claim did not match the expected session; refusing execution')\n        return new Response(JSON.stringify({ error: 'unexpected_claim' }), { status: 409, headers: { 'Content-Type': 'application/json' } })\n      }\n    }\n  } catch {}\n  return response\n}\nawait import(${JSON.stringify(entryUrl)})\n`)
  state.workerBootstrap = at; save(state)
  return at
}

async function startWorker(cfg, state, attempt) {
  if (!(await portAvailable(PORT))) throw new Error(`port ${PORT} is already in use`)
  const secret = randomBytes(24).toString('hex')
  const wrapper = createBudgetWrapper(state)
  const bootstrap = createOneClaimBootstrap(cfg, state, attempt)
  const logFile = join(dirname(state.registryPath), 'worker.log')
  const env = { ...process.env, AEON_BASE_URL: cfg.baseUrl, KAIROS_AEON_API_KEY: cfg.apiKey, KAIROS_MODE: 'poll', KAIROS_REPOS_FILE: state.registryPath, KAIROS_WORKTREE_ROOT: join(dirname(state.registryPath), 'worktrees'), KAIROS_MAX_CONCURRENT: '1', KAIROS_WORKER_PORT: String(PORT), KAIROS_WORKER_SECRET: secret, KAIROS_POLL_INTERVAL_MS: '15000', KAIROS_HEARTBEAT_MS: '30000', KAIROS_COPILOT_DEFAULT_MODEL: cfg.model, KAIROS_COPILOT_BIN: wrapper, NODE_USE_SYSTEM_CA: '1', NODE_TLS_REJECT_UNAUTHORIZED: '1' }
  const child = spawn(process.execPath, ['--use-system-ca', '--import', 'tsx', bootstrap], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk) => appendFileSync(logFile, chunk))
  state.worker = { pid: child.pid, startedAt: now(), port: PORT }; save(state)
  try {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1000) })
        if (res.ok) { const health = await res.json(); state.worker.workerId = health.workerId; save(state); return child }
      } catch { /* booting */ }
      if (child.exitCode !== null) throw new Error(`worker exited during startup (${child.exitCode}); inspect ${relative(ROOT, logFile)}`)
      await sleep(1000)
    }
    throw new Error('worker health did not become ready within 30 seconds')
  } catch (err) {
    await cancelOwnSession(cfg, attempt)
    if (child.pid) { try { process.kill(child.pid, 'SIGTERM') } catch { /* already gone */ } }
    for (let i = 0; i < 20 && await workerHealth(); i++) await sleep(250)
    if (await workerHealth()) throw new Error(`worker startup failed and cleanup could not stop it: ${err instanceof Error ? err.message : String(err)}`)
    state.worker = null; save(state)
    throw err
  }
}

async function workerHealth() {
  try { const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2000) }); return res.ok ? await res.json() : null } catch { return null }
}

async function stopWorker(state, child = null) {
  const health = await workerHealth()
  if (health?.live?.length) throw new Error(`worker still has ${health.live.length} live child process(es); refusing to stop it`)
  const pid = child?.pid ?? state.worker?.pid
  if (!child && pid) {
    if (!health) {
      try { process.kill(pid, 0) } catch (err) { if (err?.code === 'ESRCH') { state.worker = null; save(state); return } }
      throw new Error('recorded worker PID is live but its health endpoint is unavailable; refusing a PID-reuse-unsafe kill')
    }
    if (!state.worker?.workerId || health.workerId !== state.worker.workerId) throw new Error('worker health identity does not match this run state')
    const script = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}'; if ($p) { $p.CommandLine }`
    const commandLine = run('pwsh', ['-NoProfile', '-Command', script])
    if (!state.workerBootstrap || !commandLine.toLowerCase().includes(state.workerBootstrap.toLowerCase())) throw new Error('recorded PID command line is not this workflow worker; refusing to kill it')
  }
  if (pid) {
    try { process.kill(pid, 'SIGTERM') } catch (err) { if (err?.code !== 'ESRCH') throw err }
    for (let i = 0; i < 20 && await workerHealth(); i++) await sleep(250)
  }
  if (await workerHealth()) throw new Error('workflow worker did not stop; run state retained')
  state.worker = null; save(state)
}

async function cancelOwnSession(cfg, attempt) {
  if (!attempt?.sessionId) return
  const session = await api(cfg, `/api/v1/sessions/${attempt.sessionId}`)
  if (!TERMINAL.has(session.status)) await api(cfg, `/api/v1/sessions/${attempt.sessionId}/kill`, { method: 'POST', body: {} })
  for (let i = 0; i < 30; i++) {
    const health = await workerHealth()
    if (!health?.live?.some((live) => live.sessionId === attempt.sessionId)) return
    await sleep(1000)
  }
  throw new Error(`own session ${attempt.sessionId} did not release its worker child after cancellation`)
}

async function waitForTerminal(cfg, state, attempt) {
  const deadline = Date.now() + 8 * 60_000
  while (Date.now() < deadline) {
    const session = await api(cfg, `/api/v1/sessions/${attempt.sessionId}`)
    attempt.lastStatus = session.status; attempt.workerId = session.claimedBy ?? null; attempt.workerHost = session.workerHost ?? null; attempt.workerPid = session.workerPid ?? null; save(state)
    console.log(`[${now()}] ${String(attempt.index).padStart(2, '0')}/${String(state.batchTarget ?? state.attempts.length).padStart(2, '0')} session=${attempt.sessionId} status=${session.status}`)
    if (TERMINAL.has(session.status)) return session
    await sleep(15_000)
  }
  await api(cfg, `/api/v1/sessions/${attempt.sessionId}/kill`, { method: 'POST', body: {} })
  await cancelOwnSession(cfg, attempt)
  throw new Error(`session ${attempt.sessionId} exceeded eight minutes and was killed`)
}

function missionWorktreeCleanup(state, attempt) {
  const runRoot = resolve(RUNTIME, 'runs', state.runId)
  if (resolve(state.registryPath).toLowerCase() !== join(runRoot, 'repos.json').toLowerCase()) throw new Error('state registry is outside its expected runtime run root')
  const digest = createHash('sha1').update(attempt.branch).digest('hex').slice(0, 6)
  const flat = attempt.branch.replace(/[^A-Za-z0-9._-]+/g, '-')
  const worktreeRoot = join(runRoot, 'worktrees')
  const expectedPath = resolve(worktreeRoot, 'aeon-os-test', `${flat}-${digest}`)
  if (!expectedPath.toLowerCase().startsWith(`${worktreeRoot.toLowerCase()}\\`)) throw new Error('derived mission worktree is outside the run worktree root')
  const directoryAbsent = !existsSync(expectedPath)
  const branchLine = `branch refs/heads/${attempt.branch}`
  const blocks = git(state.clonePath, 'worktree', 'list', '--porcelain').split(/\r?\n\r?\n/).filter(Boolean)
  const registrations = blocks.filter((block) => block.split(/\r?\n/).includes(branchLine))
  const normalize = (path) => resolve(path.replace(/\//g, '\\')).toLowerCase()
  const staleRegistrationAllowed = registrations.length === 0 || (
    registrations.length === 1
    && registrations[0].split(/\r?\n/).some((line) => line === 'prunable' || line.startsWith('prunable '))
    && normalize(registrations[0].split(/\r?\n/).find((line) => line.startsWith('worktree '))?.slice(9) ?? '') === normalize(expectedPath)
  )
  return { settled: directoryAbsent && staleRegistrationAllowed, directoryAbsent, registrations: registrations.length, staleRegistrationAllowed, expectedPath }
}

async function waitForDelivery(state, attempt) {
  const branchRef = `refs/heads/${attempt.branch}`
  for (let i = 0; i < 60; i++) {
    let sha = null
    try { sha = run('git', ['--git-dir', state.originPath, 'rev-parse', '--verify', branchRef]) } catch { /* not pushed yet */ }
    const health = await workerHealth()
    const active = health?.live?.some((s) => s.sessionId === attempt.sessionId)
    const cleanup = missionWorktreeCleanup(state, attempt)
    if (sha && !active && cleanup.settled) return sha
    await sleep(1000)
  }
  throw new Error('terminal status arrived, but branch publication/physical worktree cleanup did not settle within 60 seconds')
}

function verifyGit(state, attempt, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('published branch did not resolve to a full SHA')
  run('git', ['--git-dir', state.originPath, 'merge-base', '--is-ancestor', state.baseSha, sha])
  const commits = Number(run('git', ['--git-dir', state.originPath, 'rev-list', '--count', `${state.baseSha}..${sha}`]))
  if (commits !== 1) throw new Error(`expected exactly one mission commit, found ${commits}`)
  const subject = run('git', ['--git-dir', state.originPath, 'log', '-1', '--format=%s', sha])
  if (!/^(feat|fix|docs|chore|test|refactor|perf|build|ci|revert)(\([^)]+\))?!?: .+/.test(subject)) throw new Error(`mission commit is not Conventional: ${subject}`)
  const changed = run('git', ['--git-dir', state.originPath, 'diff', '--name-only', state.baseSha, sha]).split(/\r?\n/).filter(Boolean)
  if (changed.length !== 1 || changed[0] !== attempt.report) throw new Error(`mission changed disallowed paths: ${changed.join(', ') || '(none)'}`)
  const content = runRaw('git', ['--git-dir', state.originPath, 'show', `${sha}:${attempt.report}`])
  if (!content.includes(attempt.marker)) throw new Error('report is missing its unique marker')
  // Same shape the reviewer bundle resolves, so a shorthand continuation
  // ("file.ts:173, :187") is validated here too and never reaches the reviewer
  // unresolved.
  // The floor counts only full path:line citations, exactly as before; the
  // shorthand expansions are validated but never let a thin report clear it.
  const explicit = assertCitationFloor(content)
  const citations = [...new Set([...explicit, ...extractCitations(content).distinct.map((c) => `${c.path}:${c.startLine}`)])]
  for (const citation of citations) {
    const split = citation.lastIndexOf(':')
    const path = citation.slice(0, split)
    const line = Number(citation.slice(split + 1))
    if (!path.includes('/') || path.startsWith('/') || path.split('/').includes('..')) throw new Error(`invalid citation path ${citation}`)
    let source
    try { source = runRaw('git', ['--git-dir', state.originPath, 'show', `${state.baseSha}:${path}`]) } catch { throw new Error(`citation does not exist at prepared base: ${citation}`) }
    const lines = source.split(/\r?\n/).length
    if (!Number.isInteger(line) || line < 1 || line > lines) throw new Error(`citation line is outside the prepared source: ${citation} (${lines} lines)`)
  }
  return { content, citations }
}

function assertSecretAbsent(cfg, label, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.includes(cfg.apiKey)) throw new Error(`${label} contained the Aeon credential; evidence was not persisted`)
}

async function validateAttempt(cfg, state, attempt, terminal) {
  if (terminal.status !== 'succeeded') throw new Error(`session ended ${terminal.status}`)
  if (terminal.exitCode !== 0) throw new Error(`session succeeded with non-zero or missing exitCode (${String(terminal.exitCode)})`)
  const sha = await waitForDelivery(state, attempt)
  const { content, citations } = verifyGit(state, attempt, sha)
  const eventsData = await api(cfg, `/api/v1/sessions/${attempt.sessionId}/events?tail=true&limit=500`)
  const results = (eventsData?.events ?? []).filter((e) => e.kind === 'result')
  if (results.length !== 1) throw new Error(`expected one result event, found ${results.length}`)
  const envelope = results[0].payload ?? {}
  assertSecretAbsent(cfg, 'report', content)
  assertSecretAbsent(cfg, 'result envelope', envelope)
  assertSecretAbsent(cfg, 'session events', eventsData.events ?? [])
  if (envelope.status !== 'completed' || envelope.branch !== attempt.branch || envelope.commit !== sha) throw new Error('result envelope branch/full commit/status does not match delivered branch')
  if (!Array.isArray(envelope.artifacts) || envelope.artifacts.length !== 1 || envelope.artifacts[0] !== attempt.report || !String(envelope.summary).includes(attempt.marker)) throw new Error('result envelope marker/artifact does not match the report')
  if (envelope.tests?.status !== 'not_run') throw new Error('research mission did not report tests honestly as not_run')
  const card = await api(cfg, `/api/v1/projects/${state.projectId}/tasks/${attempt.taskId}`)
  const cached = card?.metadata?.hangar?.lastResult
  if (!cached || !isDeepStrictEqual(cached, envelope)) throw new Error('card.lastResult does not exactly match the accepted result envelope')
  if (card.columnId !== state.columns.Landing) throw new Error('completed card did not land in the dedicated Landing column')
  const reread = await api(cfg, `/api/v1/sessions/${attempt.sessionId}`)
  if (reread.status !== 'succeeded') throw new Error('persisted session reread is not succeeded')
  const evidence = { runId: state.runId, attempt: attempt.index, result: 'PASS', marker: attempt.marker, projectId: state.projectId, taskId: attempt.taskId, sessionId: attempt.sessionId, workerId: reread.claimedBy ?? attempt.workerId, workerHost: reread.workerHost ?? attempt.workerHost, workerPid: reread.workerPid ?? attempt.workerPid, sourceBranch: state.sourceBranch, baseSha: state.baseSha, branch: attempt.branch, commit: sha, artifact: attempt.report, artifactSha256: createHash('sha256').update(content).digest('hex'), artifactContent: content, citations, requestedEngine: 'copilot', requestedModel: attempt.model, observedModel: envelope.stats?.model ?? 'unknown', sessionStatus: reread.status, cardColumnId: card.columnId, resultEventSeq: results[0].seq, spawnedAt: reread.spawnedAt ?? null, startedAt: reread.startedAt ?? null, endedAt: reread.endedAt ?? null, validatedAt: now(), independentContentReview: 'pending', uiLaunchWrapperExercised: false }
  const reports = join(resultDir(state), 'reports'); mkdirSync(reports, { recursive: true }); writeFileSync(join(reports, `${String(attempt.index).padStart(2, '0')}.md`), content)
  persist(state, `attempt-${String(attempt.index).padStart(2, '0')}.json`, evidence)
  return evidence
}

async function validateAfterWorkerStop(cfg, state, attempt, evidence) {
  if (await workerHealth()) throw new Error('workflow worker is still reachable during the persisted-state reread')
  const cleanup = missionWorktreeCleanup(state, attempt)
  if (!cleanup.settled) throw new Error(`mission worktree cleanup changed after worker stop (directoryAbsent=${cleanup.directoryAbsent}, registrations=${cleanup.registrations}, prunableOnly=${cleanup.staleRegistrationAllowed})`)
  const session = await api(cfg, `/api/v1/sessions/${attempt.sessionId}`)
  const card = await api(cfg, `/api/v1/projects/${state.projectId}/tasks/${attempt.taskId}`)
  const sha = run('git', ['--git-dir', state.originPath, 'rev-parse', '--verify', `refs/heads/${attempt.branch}`])
  if (session.status !== 'succeeded' || session.exitCode !== 0 || sha !== evidence.commit) throw new Error('session or branch changed after the worker stopped')
  if (!isDeepStrictEqual(card?.metadata?.hangar?.lastResult, (await api(cfg, `/api/v1/sessions/${attempt.sessionId}/events?tail=true&limit=500`))?.events?.find((event) => event.kind === 'result')?.payload)) throw new Error('card result changed after the worker stopped')
  evidence.persistedAfterWorkerStopAt = now()
  persist(state, `attempt-${String(attempt.index).padStart(2, '0')}.json`, evidence)
}

async function runBatch(count) {
  const cfg = parseEnv()
  const state = load()
  if (state.status === 'failed') throw new Error('this run is failed; inspect its durable evidence before preparing another run')
  // A terminal run is a receipt, not a workspace. Without this, `run
  // --count=10` against a finished ten-attempt run rewrote models.json and
  // run.json and dropped a `passed` run back to review_pending.
  if (['passed', 'partial_pass'].includes(state.status)) throw new Error(`run ${state.runId} is ${state.status}; a terminal run is immutable — use prepare --new to start another`)
  if (count < state.attempts.length) throw new Error(`count ${count} is below the ${state.attempts.length} attempts already created`)
  if (count === state.attempts.length) throw new Error(`count ${count} would create no new attempt; run ${state.runId} already has ${state.attempts.length}`)
  const priorFailure = state.attempts.find((a) => a.result === 'FAIL')
  if (priorFailure) throw new Error(`attempt ${priorFailure.index} already failed; refusing to continue the batch`)
  const models = await verifyModel(cfg)
  persist(state, 'models.json', { checkedAt: now(), configuredModel: cfg.model, models })
  await assertNoLiveCardSessions(cfg)
  const deadline = Date.now() + 90 * 60_000
  state.batchTarget = count; save(state)
  try {
    for (let index = state.attempts.length; index < count; index++) {
      if (Date.now() >= deadline) throw new Error('batch exceeded 90 minutes')
      const seed = missionPrompt(state, index, 'pending')
      const metadata = { hangar: { objective: 'recon', repo: 'aeon-os-test', agent: 'copilot', model: cfg.model, instruction: seed.text, outputMode: 'auto', autoRun: false, subagents: [], sessionIds: [] } }
      const task = await api(cfg, `/api/v1/projects/${state.projectId}/tasks`, { method: 'POST', body: { name: `Aeon OS E2E ${String(index + 1).padStart(2, '0')}: ${TOPICS[index][0]}`, description: seed.marker, columnId: state.columns.Queued, status: 'todo', priority: 'medium', color: 'purple', onTimeline: false, metadata } })
      const prompt = missionPrompt(state, index, task.id)
      await api(cfg, `/api/v1/projects/${state.projectId}/tasks/${task.id}`, { method: 'PUT', body: { metadata: { hangar: { ...metadata.hangar, instruction: prompt.text } } } })
      const sessionBody = { engine: 'copilot', goal: task.name, prompt: prompt.text, repo: 'aeon-os-test', branch: null, projectId: state.projectId, taskId: task.id, metadata: { hangar: { objective: 'recon', model: cfg.model, subagents: [], outputMode: 'auto', repo: 'aeon-os-test' } } }
      let spawned
      try {
        spawned = await api(cfg, '/api/v1/sessions', { method: 'POST', body: sessionBody })
      } catch (err) {
        const matches = (await listSessions(cfg)).filter((session) => session.taskId === task.id)
        if (matches.length !== 1) throw err
        spawned = { session: matches[0], dispatched: null, reconciledAfterUnknownResponse: true }
      }
      const attempt = { index: index + 1, topic: TOPICS[index][0], marker: prompt.marker, report: prompt.report, model: cfg.model, taskId: task.id, sessionId: spawned?.session?.id ?? null, branch: `aeon/${task.id.slice(0, 8)}`, createdAt: now(), result: 'RUNNING' }
      state.attempts.push(attempt); save(state)
      if (spawned?.dispatched !== false || spawned?.session?.status !== 'queued') {
        if (attempt.sessionId) await api(cfg, `/api/v1/sessions/${attempt.sessionId}/kill`, { method: 'POST', body: {} })
        throw new Error(`production spawn unexpectedly dispatched or was not queued (dispatched=${String(spawned?.dispatched)}, status=${String(spawned?.session?.status)})`)
      }
      const session = await api(cfg, `/api/v1/sessions/${spawned.session.id}`)
      if (session.status !== 'queued' || session.claimedBy || session.workerPid || session.startedAt) {
        await api(cfg, `/api/v1/sessions/${session.id}/kill`, { method: 'POST', body: {} })
        throw new Error('session changed before the isolated runner was allowed to claim it')
      }
      await assertNoLiveCardSessions(cfg, session.id)
      let worker = null
      let evidence = null
      try {
        worker = await startWorker(cfg, state, attempt)
        const terminal = await waitForTerminal(cfg, state, attempt)
        evidence = await validateAttempt(cfg, state, attempt, terminal)
      } finally {
        if (worker) {
          await cancelOwnSession(cfg, attempt)
          await stopWorker(state, worker)
        }
      }
      if (!evidence) throw new Error('attempt produced no validation evidence')
      await validateAfterWorkerStop(cfg, state, attempt, evidence)
      attempt.result = evidence.result; attempt.commit = evidence.commit; attempt.completedAt = now(); save(state)
    }
    // Mechanical validation is now only half the gate. Every attempt passed
    // its plumbing checks, so the run advances to review_pending and waits
    // for an independent verdict on the research itself.
    state.mechanical = state.attempts.length === 10 ? 'passed' : 'partial_pass'
    delete state.failureKind
    applyGate(state); save(state)
    persist(state, 'run.json', runRecord(state, cfg))
  } catch (err) {
    const current = state.attempts.at(-1)
    if (current?.result === 'RUNNING') { current.result = 'FAIL'; current.error = err instanceof Error ? err.message : String(err); current.failedAt = now(); persist(state, `attempt-${String(current.index).padStart(2, '0')}.json`, { ...current, result: 'FAIL' }) }
    // Refresh the review view so a failure receipt never carries a stale gate
    // from an earlier partial run, then let the mechanical failure own the
    // status: review can no longer close on a run that did not deliver.
    state.review = evaluateReviewGate({ attempts: state.attempts, verdicts: loadVerdicts(resultDir(state)) })
    state.status = 'failed'; state.mechanical = 'failed'; state.failureKind = 'mechanical'; save(state)
    persist(state, 'run.json', runRecord(state, cfg))
    throw err
  } finally { /* each attempt owns and stops its worker */ }
  console.log(`Validated ${count} distinct production session workflow attempt(s) for run ${state.runId}.`)
  console.log(`Run ${state.runId} is ${state.status}: mechanical validation is complete, ${state.review.reviewed}/${state.review.total} attempt(s) carry an independent review verdict. Run "review" to close the gate.`)
}

// Independent review is a required part of the PASS gate, not a postscript.
// Each unreviewed attempt gets its own reviewer package (report plus every
// citation resolved to the real source line at the pinned revision) and a
// reviewer that is not the model under review.
async function reviewCommand(args) {
  const options = { attempt: null, import: null, allowSameModel: false, force: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--allow-same-model') {
      if (options.allowSameModel) throw new Error('--allow-same-model was provided more than once')
      options.allowSameModel = true
      continue
    }
    if (arg === '--force') {
      if (options.force) throw new Error('--force was provided more than once')
      options.force = true
      continue
    }
    const attemptMatch = /^--attempt=(\d+)$/.exec(arg)
    if (attemptMatch) {
      if (options.attempt !== null) throw new Error('--attempt was provided more than once')
      options.attempt = Number(attemptMatch[1])
      continue
    }
    const importMatch = /^--import=(.+)$/.exec(arg)
    if (importMatch) {
      if (options.import !== null) throw new Error('--import was provided more than once')
      options.import = importMatch[1]
      continue
    }
    if (arg === '--import') {
      if (options.import !== null) throw new Error('--import was provided more than once')
      const value = args[i + 1]
      if (!value || value.startsWith('--')) throw new Error('--import requires a verdict file path')
      options.import = value
      i += 1
      continue
    }
    throw new Error(`unknown review argument: ${arg}`)
  }
  if (options.attempt !== null && (!Number.isInteger(options.attempt) || options.attempt < 1)) throw new Error('--attempt must be a positive integer')
  if (options.import && options.allowSameModel) throw new Error('--allow-same-model has no meaning for an imported verdict')
  if (options.force && !options.import) throw new Error('--force only applies to --import; a dispatched review never overwrites a stored verdict')
  const state = load()
  // Terminal receipts are immutable. A run that finished before this gate
  // existed stays legacy, and a failure is never repaired into a pass.
  if (state.status !== 'review_pending') {
    throw new Error(`run ${state.runId} is ${state.status}; review only runs on a run awaiting review. Terminal receipts are retained unchanged.`)
  }
  let secrets = []
  try { secrets = [parseEnv().apiKey] } catch { /* review needs no Aeon call; scan for the credential only when it is knowable */ }
  const runDir = resultDir(state)
  if (options.import) {
    const record = importVerdict({ runId: state.runId, runDir, attempts: state.attempts, file: options.import, attempt: options.attempt, secrets, force: options.force })
    console.log(`Imported ${record.verdict} for attempt ${String(record.attempt).padStart(2, '0')} of run ${state.runId}.`)
  } else {
    const config = reviewConfig(readBootstrap())
    const outcome = await runReview({
      runId: state.runId,
      runDir,
      attempts: state.attempts,
      config,
      allowSameModel: options.allowSameModel,
      only: options.attempt,
      secrets,
    })
    if (outcome.failures.length) console.error(`${outcome.failures.length} attempt(s) produced no usable verdict and are still counted as NOT reviewed.`)
  }
  const gate = applyGate(state); save(state)
  persist(state, 'run.json', runRecord(state, null))
  console.log(JSON.stringify({ runId: state.runId, status: state.status, review: reviewView(state) }, null, 2))
  // Only a completed, clean review is a success. A run left review_pending
  // because attempts are unreviewed must not report success to a caller.
  if (gate.outcome !== 'review_passed') process.exitCode = 1
}

function reviewView(state) {
  if (legacyGate(state)) {
    return { legacy: true, note: 'this run completed before the independent-review gate existed; its receipt is retained unchanged and is not retro-marked' }
  }
  const gate = evaluateReviewGate({ attempts: state.attempts, verdicts: loadVerdicts(resultDir(state)) })
  return {
    legacy: false,
    progress: `${gate.reviewed}/${gate.total} reviewed`,
    outcome: gate.outcome,
    counts: gate.counts,
    unreviewed: gate.unreviewed,
    verdicts: gate.attempts.map((entry) => ({ attempt: entry.attempt, verdict: entry.verdict, reviewer: entry.reviewerModel, error: entry.error })),
  }
}

async function status() {
  const state = load()
  let remote = null
  try {
    const cfg = parseEnv()
    const current = state.attempts.at(-1)
    if (current?.sessionId) remote = await api(cfg, `/api/v1/sessions/${current.sessionId}`)
  } catch (err) { remote = { unavailable: err instanceof Error ? err.message : String(err) } }
  const review = reviewView(state)
  const verdicts = new Map((review.verdicts ?? []).map((entry) => [entry.attempt, entry.verdict]))
  console.log(JSON.stringify({ runId: state.runId, status: state.status, mechanical: state.mechanical ?? null, review, projectId: state.projectId, attempts: state.attempts.map((a) => ({ index: a.index, result: a.result, verdict: verdicts.get(a.index) ?? null, sessionId: a.sessionId, commit: a.commit ?? null })), currentRemote: remote && { status: remote.status, id: remote.id }, worker: await workerHealth() }, null, 2))
}

async function stop() {
  const cfg = parseEnv()
  const state = load()
  const current = [...state.attempts].reverse().find((a) => a.result === 'RUNNING')
  if (current) {
    await api(cfg, `/api/v1/sessions/${current.sessionId}/kill`, { method: 'POST', body: {} })
    for (let i = 0; i < 30; i++) { const health = await workerHealth(); if (!health?.live?.length) break; await sleep(1000) }
  }
  await stopWorker(state)
  console.log('Stopped only the workflow runner recorded in this run state; any active mission was killed first.')
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (!command) return help()
  if (command === 'review') return reviewCommand(rest)
  const [option, ...extra] = rest
  if (extra.length) throw new Error('unexpected arguments')
  if (command === 'preflight' && !option) return preflight()
  if (command === 'prepare' && (!option || option === '--new')) return prepare(option === '--new')
  if (command === 'status' && !option) return status()
  if (command === 'stop' && !option) return stop()
  if (command === 'run') {
    const match = /^--count=(\d+)$/.exec(option ?? '')
    const count = match ? Number(match[1]) : 0
    if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('run requires --count=N where N is an integer from 1 to 10')
    return runBatch(count)
  }
  throw new Error('unknown command or invalid arguments')
}

main().catch((err) => { console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`); process.exitCode = 1 })
