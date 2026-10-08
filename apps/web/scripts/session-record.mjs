// Session record v1 for coding-agent captures.
//
// Pure helpers (plus a few best-effort filesystem / git reads) shared by the
// dispatchers and claude-session-capture.mjs. Kept out of the capture script
// because that file runs main() at import time and can never be unit-tested.
//
// KEY NAMES ARE A CROSS-LANGUAGE CONTRACT with apps/web/src/lib/kairos/
// session-record.ts (the server-side writer/reader of the same record at
// memories.sourceMetadata.session). Rename nothing on one side only.
// Design: research/kairos_2909/03_capture_and_recency.md §C.
//
// Everything here must be safe to call from a live SessionEnd hook: no
// function throws on malformed input, and every git/fs read is bounded.

import { execFileSync } from 'node:child_process'
import { existsSync, openSync, readSync, closeSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copilotTelemetry } from './session-record-copilot.mjs'

export const SESSION_RECORD_VERSION = 1
export const FIRST_PROMPT_MAX = 500
export const FILES_MAX = 50
export const TAG_MAX_LENGTH = 50
export const TAGS_MAX = 50
const COMMITS_MAX = 20
const PRS_MAX = 20
const SUBJECT_MAX = 200

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value)
}

function cleanString(value, max = 200) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

function nonNegInt(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
}

// ─── tags ───────────────────────────────────────────────────────────────

/**
 * memoryCreateSchema caps each tag at 50 chars and the list at 50 entries.
 * One over-long `branch:<name>` tag used to 400 the WHOLE capture, which then
 * retried and dead-lettered — the session was lost. Clamp instead.
 */
export function clampTags(tags) {
  if (!Array.isArray(tags)) return []
  const out = []
  const seen = new Set()
  for (const tag of tags) {
    if (typeof tag !== 'string') continue
    const clamped = tag.trim().slice(0, TAG_MAX_LENGTH).trim()
    if (!clamped || seen.has(clamped)) continue
    seen.add(clamped)
    out.push(clamped)
    if (out.length >= TAGS_MAX) break
  }
  return out
}

// ─── repo identity ──────────────────────────────────────────────────────

// Hangar registry slug → canonical dev_26 folder, used only when the local
// registry file does not know the slug (it is machine-specific and partial).
// Derived from each registry entry's git_url basename.
export const HANGAR_SLUG_FALLBACK = Object.freeze({
  aeon: 'shadow_app_aeon',
  arq: 'shadow_app_arq',
  relic: 'stp_app_relic',
  swarm: 'shadow_app_swarm',
  'shadow-research-lab': 'shadow_research_lab',
})

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_REGISTRY_PATH = join(scriptDir, '..', '..', 'kairos-worker', 'repos.local.yaml')

function normPath(p) {
  if (typeof p !== 'string' || !p) return ''
  let s = p.replace(/\\/g, '/').replace(/\/+$/, '')
  // Git Bash / WSL style /c/Users/... → C:/Users/...
  const drive = s.match(/^\/([a-zA-Z])\/(.*)$/)
  if (drive) s = `${drive[1].toUpperCase()}:/${drive[2]}`
  return s
}

function lastSegment(p) {
  const s = normPath(p)
  const i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

/** Tiny reader for repos.local.yaml: `repos:` → `  <slug>:` → `    path: <p>`. */
export function parseRepoRegistry(text) {
  const map = new Map()
  if (typeof text !== 'string') return map
  let inRepos = false
  let current = null
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (/^\s*(#|$)/.test(raw)) continue
    if (/^repos:\s*$/.test(raw)) { inRepos = true; current = null; continue }
    if (/^\S/.test(raw)) { inRepos = false; current = null; continue }
    if (!inRepos) continue
    const key = raw.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/)
    if (key) { current = key[1]; continue }
    const path = raw.match(/^ {4}path:\s*(.+?)\s*$/)
    if (path && current) {
      const value = path[1].replace(/^['"]|['"]$/g, '')
      const folder = lastSegment(value)
      if (folder) map.set(current, folder)
    }
  }
  return map
}

let registryCache = null
export function loadRepoRegistry(path = DEFAULT_REGISTRY_PATH) {
  if (path === DEFAULT_REGISTRY_PATH && registryCache) return registryCache
  let map = new Map()
  try {
    if (existsSync(path)) map = parseRepoRegistry(readFileSync(path, 'utf8'))
  } catch {
    map = new Map()
  }
  if (path === DEFAULT_REGISTRY_PATH) registryCache = map
  return map
}

function remoteBasename(remote) {
  if (typeof remote !== 'string' || !remote.trim()) return null
  const base = lastSegment(remote.trim().replace(/:/g, '/')).replace(/\.git$/i, '')
  return base || null
}

// Scratch locations that are never a real repo, even when `git init`-ed.
function isScratchPath(p) {
  const s = normPath(p).toLowerCase()
  if (!s) return true
  if (/\/appdata\/local\/temp(\/|$)/.test(s)) return true
  if (/\/\.copilot\/session-state(\/|$)/.test(s)) return true
  if (/\/dev_26$/.test(s)) return true
  const tmp = normPath(tmpdir()).toLowerCase()
  return Boolean(tmp) && (s === tmp || s.startsWith(`${tmp}/`))
}

/**
 * Canonical repo identity for a session's cwd.
 *
 * - `.aeon-worktrees/<hangarSlug>/<worktree>` → the registry folder for that
 *   slug (repos.local.yaml path basename, then the built-in map, then the git
 *   remote basename), flagged worktree:true with registrySlug set. The old
 *   rule took the first segment after dev_26 and filed every mission under
 *   the fake repo ".aeon-worktrees".
 * - `dev_26/<folder>/...` → folder.
 * - anything else → `git rev-parse --show-toplevel` basename when that is a
 *   real repo, else null. Temp dirs, Copilot session-state bench dirs and bare
 *   dev_26 resolve to null rather than a fake slug.
 */
export function resolveRepoIdentity(cwd, { toplevel = null, remote = null, registry = null } = {}) {
  const candidates = [normPath(cwd), normPath(toplevel)].filter(Boolean)
  for (const candidate of candidates) {
    const m = candidate.match(/\/\.aeon-worktrees\/([^/]+)(?:\/|$)/i)
    if (!m) continue
    const slug = m[1]
    const reg = registry || loadRepoRegistry()
    const repo = reg.get(slug) || HANGAR_SLUG_FALLBACK[slug] || remoteBasename(remote) || null
    return { repo, registrySlug: slug, worktree: true }
  }
  for (const candidate of candidates) {
    const m = candidate.match(/\/dev_26\/([^/]+)/i)
    if (m && !m[1].startsWith('.')) return { repo: m[1] }
  }
  if (toplevel && !isScratchPath(toplevel)) {
    const base = lastSegment(toplevel)
    if (base) return { repo: base }
  }
  return { repo: null }
}

// ─── git (dispatch time) ────────────────────────────────────────────────

export function runGit(cwd, args) {
  try {
    const out = execFileSync('git', args, {
      cwd: normPath(cwd) || undefined,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2500,
      windowsHide: true,
    })
    return typeof out === 'string' ? out.trim() : null
  } catch {
    return null
  }
}

function parseGitLog(raw) {
  if (!raw) return []
  const commits = []
  for (const line of raw.split('\n')) {
    const [sha, ...rest] = line.split('\x1f')
    if (!/^[0-9a-f]{7,40}$/.test(sha || '')) continue
    commits.push({ sha, subject: rest.join(' ').trim().slice(0, SUBJECT_MAX) })
    if (commits.length >= COMMITS_MAX) break
  }
  return commits
}

/** Earliest ISO timestamp in the first 256KB of a JSONL transcript, or null. */
export function readTranscriptStart(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null
  let fd
  try {
    fd = openSync(transcriptPath, 'r')
    const buffer = Buffer.allocUnsafe(256 * 1024)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    const head = buffer.toString('utf8', 0, read)
    const m = head.match(/"timestamp"\s*:\s*"(\d{4}-\d{2}-\d{2}T[0-9:.]+Z?)"/)
    return m ? m[1] : null
  } catch {
    return null
  } finally {
    if (fd !== undefined) { try { closeSync(fd) } catch {} }
  }
}

/**
 * Git facts gathered while the session's checkout still exists. A Hangar
 * mission's worktree is torn down before the detached drain runs, so the
 * drain can no longer read branch or commits from it.
 */
export function collectGitContext(cwd, { since = null, git = runGit } = {}) {
  const toplevel = git(cwd, ['rev-parse', '--show-toplevel'])
  if (!toplevel) return null
  const ctx = { toplevel }
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch && branch !== 'HEAD') ctx.branch = branch
  const remote = git(cwd, ['remote', 'get-url', 'origin'])
  if (remote) ctx.remote = remote
  const head = git(cwd, ['rev-parse', 'HEAD'])
  if (head && /^[0-9a-f]{40}$/.test(head)) ctx.headSha = head
  const fmt = '--pretty=format:%H%x1f%s'
  if (since) {
    ctx.commits = parseGitLog(git(cwd, ['log', fmt, `--since=${since}`, '-n', String(COMMITS_MAX)]))
  } else if (/\/\.aeon-worktrees\//i.test(normPath(toplevel))) {
    // No start time known: a mission branch's unpushed commits ARE its work.
    ctx.commits = parseGitLog(git(cwd, ['log', fmt, 'HEAD', '--not', '--remotes', '-n', String(COMMITS_MAX)]))
  }
  return ctx
}

// ─── Hangar brief ───────────────────────────────────────────────────────

/** kairos-worker writes the mission brief here (poller.ts briefFileFor). */
export function hangarBriefPath(hangarSessionId, dir = tmpdir()) {
  return join(dir, `aeon-hangar-${hangarSessionId}-brief.md`)
}

export function parseHangarBrief(text) {
  const out = {}
  if (typeof text !== 'string') return out
  const mission = text.match(/^Mission:\s*(.+)$/m)
  if (mission) out.cardName = cleanString(mission[1], 255)
  const objective = text.match(/^Objective:\s*(.+)$/m)
  if (objective) out.objective = cleanString(objective[1], 60)
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined))
}

export function readHangarBrief(hangarSessionId, dir = tmpdir()) {
  if (typeof hangarSessionId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(hangarSessionId)) return {}
  try {
    const path = hangarBriefPath(hangarSessionId, dir)
    return existsSync(path) ? parseHangarBrief(readFileSync(path, 'utf8').slice(0, 64 * 1024)) : {}
  } catch {
    return {}
  }
}

/** Objective from the one-line brief pointer the poller passes as argv. */
export function objectiveFromPointer(firstPrompt) {
  const m = typeof firstPrompt === 'string' && firstPrompt.match(/^Aeon Hangar mission \(([a-z_]+)\)/i)
  return m ? m[1] : undefined
}

// ─── dispatch context ───────────────────────────────────────────────────

/**
 * Stamp the queued job with what only the hook process knows: the Hangar env
 * (KAIROS_SESSION_ID, AEON_TASK_ID), the mission brief, and git state of a
 * checkout that may be deleted before the drain runs. Never throws — on any
 * failure the payload is returned unchanged so the capture still queues.
 */
export function withDispatchContext(payload, { env = process.env, git = runGit, now = () => new Date(), briefDir = tmpdir() } = {}) {
  try {
    if (!payload || typeof payload !== 'object') return payload
    const ctx = { v: 1, at: now().toISOString() }
    const hangarSessionId = cleanString(env.KAIROS_SESSION_ID, 128)
    if (hangarSessionId) {
      ctx.hangarSessionId = hangarSessionId
      Object.assign(ctx, readHangarBrief(hangarSessionId, briefDir))
    }
    const taskId = cleanString(env.AEON_TASK_ID, 128)
    if (taskId) ctx.taskId = taskId
    const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()
    const gitCtx = collectGitContext(cwd, { since: readTranscriptStart(payload.transcript_path), git })
    if (gitCtx) ctx.git = gitCtx
    return { ...payload, dispatch: ctx }
  } catch {
    return payload
  }
}

// ─── transcript telemetry ───────────────────────────────────────────────

const TEST_COMMAND = /\b(vitest|jest|pytest|playwright test|mocha|go test|cargo test|dotnet test|node --test|run-session-capture-tests|npm (?:run )?test|npm run test:\w+|pnpm (?:run )?test|yarn test)\b/i
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g
const COMMIT_LINE = /^\[[^\]\s]+(?: \([^)]*\))? ([0-9a-f]{7,40})\] (.+)$/gm

function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : c?.text ?? c?.input_text ?? c?.output_text ?? '')).join('\n')
  }
  if (content && typeof content === 'object') {
    if (typeof content.output === 'string') return content.output
    if (typeof content.text === 'string') return content.text
  }
  return ''
}

function toIso(ts) {
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    const d = new Date(ts < 1e12 ? ts * 1000 : ts)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  if (typeof ts !== 'string' || !ts.trim()) return undefined
  let s = ts.trim()
  // SQLite datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC with no zone.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) s = `${s.replace(' ', 'T')}Z`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function commandOf(input) {
  if (!input) return ''
  if (typeof input === 'string') return input
  if (typeof input !== 'object') return ''
  const c = input.command ?? input.cmd ?? input.input ?? input.patch
  if (Array.isArray(c)) return c.join(' ')
  return typeof c === 'string' ? c : ''
}

// Claude: tool_use blocks (assistant) paired with tool_result blocks (user).
function claudeToolEvents(records) {
  const byId = new Map()
  const events = []
  for (const r of records) {
    const content = r?.message?.content
    if (!Array.isArray(content)) continue
    if (r.type === 'assistant') {
      for (const c of content) {
        if (c?.type === 'tool_use' && typeof c.id === 'string' && !byId.has(c.id)) {
          byId.set(c.id, { name: c.name || 'unknown', command: commandOf(c.input) })
        }
      }
    } else if (r.type === 'user') {
      for (const c of content) {
        if (c?.type !== 'tool_result') continue
        const call = byId.get(c.tool_use_id) || { name: 'unknown', command: '' }
        const tur = r.toolUseResult
        const output = tur && typeof tur === 'object' && (typeof tur.stdout === 'string' || typeof tur.stderr === 'string')
          ? `${tur.stdout || ''}\n${tur.stderr || ''}`
          : textOf(c.content)
        events.push({ ...call, output, isError: c.is_error === true })
      }
    }
  }
  return { events, calls: [...byId.values()] }
}

function codexOutputFailed(output, exitCode) {
  if (Number.isFinite(exitCode)) return exitCode !== 0
  return /(?:Process exited with code|Exit code:?)\s*([1-9]\d*)/i.test(output)
}

// Older shell tools wrap output as JSON {output, metadata:{exit_code}}.
function unwrapCodexOutput(raw) {
  const text = textOf(raw)
  if (typeof raw === 'string' && raw.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        const exitCode = parsed.metadata?.exit_code ?? parsed.exit_code
        return { output: typeof parsed.output === 'string' ? parsed.output : text, exitCode }
      }
    } catch {}
  }
  return { output: text, exitCode: undefined }
}

const CODEX_CALLS = new Set(['function_call', 'custom_tool_call', 'local_shell_call', 'mcp_tool_call'])
const CODEX_OUTPUTS = new Set(['function_call_output', 'custom_tool_call_output', 'local_shell_call_output', 'mcp_tool_call_output'])

function codexToolEvents(records) {
  const byId = new Map()
  const calls = []
  const events = []
  let eventErrors = 0
  for (const r of records) {
    const p = r?.payload
    if (!p || typeof p !== 'object') continue
    if (r.type === 'event_msg' && p.type === 'error') eventErrors++
    if (r.type !== 'response_item') continue
    if (CODEX_CALLS.has(p.type)) {
      const raw = p.arguments ?? p.input ?? p.action ?? ''
      let decoded = raw
      if (typeof raw === 'string') { try { decoded = JSON.parse(raw) } catch { decoded = raw } }
      const call = { name: p.name || p.type, command: commandOf(decoded) || (typeof raw === 'string' ? raw : '') }
      calls.push(call)
      if (typeof p.call_id === 'string') byId.set(p.call_id, call)
    } else if (CODEX_OUTPUTS.has(p.type)) {
      const call = byId.get(p.call_id) || { name: 'unknown', command: '' }
      const { output, exitCode } = unwrapCodexOutput(p.output)
      events.push({ ...call, output, isError: codexOutputFailed(output, exitCode) })
    }
  }
  return { events, calls, eventErrors }
}

function testSummaryLine(output) {
  const patterns = [
    /^\s*Tests?\s+.*\b(?:passed|failed)\b.*$/im,
    /^\s*#\s*(?:pass|fail)\s+\d+.*$/im,
    /^=+ .*\b(?:passed|failed)\b.* =+$/im,
    /^.*\b\d+\s+(?:passing|passed|failed|failing)\b.*$/im,
  ]
  for (const re of patterns) {
    const m = output.match(re)
    if (m) return m[0].trim().slice(0, 200)
  }
  return undefined
}

function testFailed(event) {
  if (event.isError) return true
  if (/\b[1-9]\d* (?:failed|failing)\b/i.test(event.output)) return true
  if (/^\s*#\s*fail\s+[1-9]/im.test(event.output)) return true
  return false
}

/** Commits, PRs, tests, error count and tool histogram from tool events. */
export function analyzeToolEvents(events, calls) {
  const out = {}
  const toolCalls = {}
  for (const call of calls) toolCalls[call.name] = (toolCalls[call.name] || 0) + 1
  if (Object.keys(toolCalls).length) out.toolCalls = toolCalls
  out.errorCount = events.filter((e) => e.isError).length

  const commits = []
  const prs = []
  let tests
  for (const e of events) {
    const cmd = e.command || ''
    const output = e.output || ''
    if (/\bgit\b[^\n]*\bcommit\b/.test(cmd) && !e.isError) {
      for (const m of output.matchAll(COMMIT_LINE)) {
        if (!commits.some((c) => c.sha === m[1])) commits.push({ sha: m[1], subject: m[2].trim().slice(0, SUBJECT_MAX) })
      }
    }
    const pr = cmd.match(/\bgh\s+pr\s+(create|merge)\b/)
    if (pr && !e.isError) {
      const action = pr[1] === 'create' ? 'created' : 'merged'
      for (const m of `${output}\n${cmd}`.matchAll(PR_URL)) {
        if (prs.some((p) => p.url === m[0])) continue
        prs.push({ number: Number(m[1]), url: m[0], action })
      }
    }
    if (TEST_COMMAND.test(cmd)) {
      const summary = testSummaryLine(output)
      tests = { status: testFailed(e) ? 'failed' : 'passed', ...(summary ? { summary } : {}) }
    }
  }
  if (commits.length) out.commits = commits.slice(0, COMMITS_MAX)
  if (prs.length) out.prs = prs.slice(0, PRS_MAX)
  if (tests) out.tests = tests
  return out
}

function claudeTelemetry(records) {
  const out = {}
  const seenUsage = new Set()
  let input = 0, output = 0, cacheRead = 0, sawUsage = false
  let costState = null
  for (const r of records) {
    if (!r || typeof r !== 'object') continue
    if (typeof r.gitBranch === 'string' && r.gitBranch && r.gitBranch !== 'HEAD') out.branch = r.gitBranch
    if (r.type === 'cost-state') costState = r
    if (r.type === 'custom-title' && typeof r.customTitle === 'string') out.customTitle = r.customTitle
    if (r.type === 'ai-title' && typeof r.aiTitle === 'string') out.aiTitle = r.aiTitle
    if (r.type !== 'assistant' || !r.message) continue
    const model = r.message.model
    if (typeof model === 'string' && model && !model.startsWith('<')) out.model = model
    const usage = r.message.usage
    const key = r.message.id || r.requestId || r.uuid
    if (usage && typeof usage === 'object' && !(key && seenUsage.has(key))) {
      if (key) seenUsage.add(key)
      sawUsage = true
      input += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
      output += usage.output_tokens || 0
      cacheRead += usage.cache_read_input_tokens || 0
    }
  }
  if (sawUsage) Object.assign(out, { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead })
  if (costState) {
    if (Number.isFinite(costState.totalCostUSD)) out.costUsd = costState.totalCostUSD
    if (Number.isFinite(costState.totalLinesAdded)) out.linesAdded = costState.totalLinesAdded
    if (Number.isFinite(costState.totalLinesRemoved)) out.linesRemoved = costState.totalLinesRemoved
  }
  const { events, calls } = claudeToolEvents(records)
  Object.assign(out, analyzeToolEvents(events, calls))
  return out
}

function codexTelemetry(records) {
  const out = {}
  let total = null
  for (const r of records) {
    const p = r?.payload
    if (!p || typeof p !== 'object') continue
    if (r.type === 'turn_context' && typeof p.model === 'string' && p.model) out.model = p.model
    if (r.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) total = p.info.total_token_usage
    if (r.type === 'session_meta' && typeof p.git?.branch === 'string' && p.git.branch) out.branch = p.git.branch
  }
  if (total) {
    const cached = total.cached_input_tokens || 0
    // Codex input_tokens already INCLUDES the cached part; report them apart.
    out.inputTokens = Math.max(0, (total.input_tokens || 0) - cached)
    out.outputTokens = total.output_tokens || 0
    out.cacheReadTokens = cached
  }
  const { events, calls, eventErrors } = codexToolEvents(records)
  Object.assign(out, analyzeToolEvents(events, calls))
  out.errorCount = (out.errorCount || 0) + eventErrors
  return out
}

export { copilotTelemetry }

/** Per-client telemetry from the raw (un-normalized) transcript records. */
export function extractTelemetry(records, client) {
  try {
    if (!Array.isArray(records)) return {}
    if (client === 'codex') return codexTelemetry(records)
    if (client === 'copilot') return copilotTelemetry(records)
    return claudeTelemetry(records)
  } catch {
    return {}
  }
}

export function sessionTimes(messages) {
  let first, last
  for (const m of messages || []) {
    const iso = toIso(m?.timestamp)
    if (!iso) continue
    if (!first || iso < first) first = iso
    if (!last || iso > last) last = iso
  }
  return { startedAt: first, endedAt: last }
}

// ─── mission envelope / title / summary ─────────────────────────────────

const ENVELOPE_STATUS = new Set(['completed', 'needs_input', 'failed'])

/** The fenced json result envelope a Hangar mission ends its final message with. */
export function parseResultEnvelope(text) {
  if (typeof text !== 'string') return null
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)]
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(blocks[i][1])
      if (parsed && typeof parsed === 'object' && ENVELOPE_STATUS.has(parsed.status)) return parsed
    } catch {}
  }
  return null
}

export function firstExecBullet(bullets) {
  return Array.isArray(bullets) ? bullets.find((b) => typeof b === 'string' && b.trim())?.trim() : undefined
}

/** `${repo}: ${cardName || aiTitle || first-prompt-60}` — the fields synthesis reads. */
export function composeTitle({ repo, cardName, aiTitle, firstPrompt }, truncate) {
  const subject = cleanString(cardName, 255) || cleanString(aiTitle, 255) ||
    truncate(String(firstPrompt || '').replace(/\s+/g, ' ').trim(), 60)
  return repo ? `${repo}: ${subject}` : subject
}

// ─── record assembly ────────────────────────────────────────────────────

const RECORD_KEYS = [
  'client', 'sessionId', 'hangarSessionId', 'taskId', 'projectId', 'repo', 'registrySlug', 'worktree',
  'startedAt', 'endedAt', 'durationMin', 'firstPrompt', 'objective', 'cardName', 'status', 'outcome',
  'questions', 'branch', 'commits', 'prs', 'tests', 'model', 'inputTokens', 'outputTokens',
  'cacheReadTokens', 'costUsd', 'linesAdded', 'linesRemoved', 'toolCalls', 'errorCount', 'files',
]
const INT_KEYS = new Set(['inputTokens', 'outputTokens', 'cacheReadTokens', 'linesAdded', 'linesRemoved', 'errorCount'])

/**
 * v1 record, same rules as buildSessionRecord() on the server: drop
 * null/undefined/empty-array keys, cap firstPrompt (500) and files (50).
 */
export function buildSessionRecord(input) {
  const record = { v: SESSION_RECORD_VERSION }
  for (const key of RECORD_KEYS) {
    let value = input?.[key]
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    if (INT_KEYS.has(key)) { value = nonNegInt(value); if (value === undefined) continue }
    if ((key === 'durationMin' || key === 'costUsd') && !(Number.isFinite(value) && value >= 0)) continue
    if (key === 'firstPrompt') value = String(value).slice(0, FIRST_PROMPT_MAX)
    if (key === 'files') value = value.filter((f) => typeof f === 'string').slice(0, FILES_MAX)
    if (key === 'toolCalls' && (typeof value !== 'object' || !Object.keys(value).length)) continue
    record[key] = value
  }
  if (!record.client || !record.sessionId) return null
  return record
}

/**
 * Merge commits from git (dispatch-time) and transcript output, deduped by
 * sha prefix, git first (full shas, authoritative).
 */
export function mergeCommits(...lists) {
  const out = []
  for (const list of lists) {
    for (const c of list || []) {
      if (!c || typeof c.sha !== 'string') continue
      if (out.some((o) => o.sha.startsWith(c.sha) || c.sha.startsWith(o.sha))) continue
      out.push(c.subject ? { sha: c.sha, subject: c.subject } : { sha: c.sha })
      if (out.length >= COMMITS_MAX) return out
    }
  }
  return out
}
