#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Aeon Brain — Claude SessionEnd capture hook.
//
// Reads the hook payload from stdin (JSON: { session_id, transcript_path,
// cwd, hook_event_name, reason }), parses the transcript JSONL, and POSTs
// a structured summary to /api/v1/memories as type=session_summary,
// source=claude.
//
// Cross-platform: pure Node 18+ (built-in fetch, no extra deps).
// Fail-safe: ALWAYS exits 0 so a failure here can never block your session.
// Errors go to stderr (visible in Claude's hook log) but never propagate.
//
// Required env: AEON_API_KEY
// Optional env: AEON_BASE_URL          (default http://localhost:3000)
//               BRAIN_DEFAULT_REALM_ID (optional default realm anchor)
//               BRAIN_DEBUG=1          (print verbose stderr)
//               BRAIN_DRY_RUN=1        (skip the POST, print payload only)
//               BRAIN_MIN_USER_TURNS   (default 3)
//               BRAIN_MIN_TOOL_USES    (default 2)
//
// Install: see docs/brain/05-session-capture.md
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'

// ─── helpers ────────────────────────────────────────────────────────────

// Auto-load .env.local from this repo so the user doesn't need to export
// anything in their shell profile. AEON_API_KEY + AEON_API_USER_ID + (optional)
// AEON_BASE_URL + BRAIN_DEFAULT_REALM_ID are all read from there.
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
if (existsSync(envPath)) {
  const envSrc = readFileSync(envPath, 'utf8').replace(/\r/g, '')
  for (const rawLine of envSrc.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = val
  }
}

const DEBUG = process.env.BRAIN_DEBUG === '1'
const DRY_RUN = process.env.BRAIN_DRY_RUN === '1'
const MIN_USER_TURNS = parseInt(process.env.BRAIN_MIN_USER_TURNS ?? '3', 10)
const MIN_TOOL_USES = parseInt(process.env.BRAIN_MIN_TOOL_USES ?? '2', 10)
const BASE_URL = (process.env.AEON_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const API_KEY = process.env.AEON_API_KEY
const DEFAULT_REALM_ID = process.env.BRAIN_DEFAULT_REALM_ID || null

const log = (...args) => DEBUG && console.error('[brain-capture]', ...args)
const warn = (...args) => console.error('[brain-capture]', ...args)

function bail(reason) {
  log('skip:', reason)
  process.exit(0)
}

// ─── repo → Aeon project resolution ─────────────────────────────────────
// Convention agreed with the user (May 2026):
//   shadow_app_X            → "X APP"            (uppercase last word)
//   <name>_dash             → "<NAME UPPERCASE> APP"
//   *_lab (snake)           → "<Title-Cased> Lab"  ("ml" stays uppercase)
// Anything outside the convention returns null and the session still gets
// tagged with the repo slug but anchors to no Aeon project.
function repoToProjectName(slug) {
  if (!slug) return null
  const s = String(slug).trim()
  const appMatch = s.match(/^shadow_app_(.+)$/)
  if (appMatch) return appMatch[1].toUpperCase() + ' APP'
  if (s.endsWith('_dash')) {
    return s.slice(0, -5).toUpperCase().replace(/_/g, ' ') + ' APP'
  }
  if (s.endsWith('_lab')) {
    return s
      .split('_')
      .map((w) =>
        w.toLowerCase() === 'ml'
          ? 'ML'
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      )
      .join(' ')
  }
  return null
}

// Derive the repo slug from cwd by walking up to the dev_26 root.
function repoSlugFromCwd(cwd) {
  if (!cwd) return null
  const norm = normalizeCwd(cwd).replace(/\\/g, '/')
  const m = norm.match(/\/dev_26\/([^/]+)/)
  return m ? m[1] : basename(norm) || null
}

const projectCache = new Map() // projectName → { id, realmId, realmName } | null
async function resolveProject(projectName) {
  if (!projectName) return null
  if (projectCache.has(projectName)) return projectCache.get(projectName)
  const url = `${BASE_URL}/api/v1/projects/resolve?name=${encodeURIComponent(projectName)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${API_KEY}` },
      signal: controller.signal,
    })
    if (!res.ok) {
      log(`resolveProject(${projectName}) → ${res.status}`)
      projectCache.set(projectName, null)
      return null
    }
    const parsed = await res.json()
    const data = parsed?.data ?? null
    projectCache.set(projectName, data)
    return data
  } catch (err) {
    log(`resolveProject(${projectName}) error: ${err.message}`)
    projectCache.set(projectName, null)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeCwd(cwd) {
  if (!cwd) return cwd
  // Convert Git Bash / WSL style `/c/Users/...` to `C:/Users/...` on Windows.
  if (process.platform === 'win32') {
    const m = cwd.match(/^\/([a-zA-Z])\/(.*)$/)
    if (m) return `${m[1].toUpperCase()}:/${m[2]}`
  }
  return cwd
}

function gitCmd(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd: normalizeCwd(cwd),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim()
  } catch {
    return null
  }
}

function readStdin() {
  // Synchronous stdin read — small payload, fine for a hook.
  try {
    const buf = readFileSync(0, 'utf8')
    return JSON.parse(buf)
  } catch (err) {
    bail(`stdin parse failed: ${err.message}`)
  }
}

// ─── transcript parsing ─────────────────────────────────────────────────

function parseTranscript(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null
  const raw = readFileSync(transcriptPath, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const messages = []
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line))
    } catch {
      // Skip malformed lines silently — transcripts can have partial writes.
    }
  }
  return messages
}

function extractFirstUserMessage(messages) {
  for (const m of messages) {
    if (m.type !== 'user') continue
    const content = m.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const text = content.find((c) => c?.type === 'text')?.text
      if (text) return text
    }
  }
  return null
}

function extractLastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.type !== 'assistant') continue
    const content = m.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const text = content
        .filter((c) => c?.type === 'text')
        .map((c) => c.text)
        .join('\n')
        .trim()
      if (text) return text
    }
  }
  return null
}

function extractFilesTouched(messages) {
  const files = new Set()
  for (const m of messages) {
    if (m.type !== 'assistant') continue
    const content = m.message?.content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      if (c?.type !== 'tool_use') continue
      const name = c.name
      const input = c.input || {}
      // Edit, Write, NotebookEdit, MultiEdit all carry a file_path
      if ((name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') && typeof input.file_path === 'string') {
        files.add(input.file_path)
      }
    }
  }
  return [...files]
}

function countSignals(messages) {
  let userTurns = 0
  let toolUses = 0
  for (const m of messages) {
    if (m.type === 'user') {
      // Filter out tool_result pseudo-users (system-generated responses).
      const c = m.message?.content
      if (typeof c === 'string') {
        userTurns++
      } else if (Array.isArray(c) && c.some((p) => p?.type === 'text')) {
        userTurns++
      }
    }
    if (m.type === 'assistant') {
      const c = m.message?.content
      if (Array.isArray(c)) {
        for (const p of c) if (p?.type === 'tool_use') toolUses++
      }
    }
  }
  return { userTurns, toolUses }
}

function sessionDurationMin(messages) {
  // Scan for the first and last valid timestamp — early/late messages
  // sometimes lack one.
  let first = 0
  let last = 0
  for (const m of messages) {
    if (!m.timestamp) continue
    const t = new Date(m.timestamp).getTime()
    if (!t || Number.isNaN(t)) continue
    if (!first) first = t
    last = t
  }
  if (!first || !last || last <= first) return 0
  return Math.round((last - first) / 60000)
}

// ─── memory payload assembly ────────────────────────────────────────────

function truncate(s, n) {
  if (!s) return ''
  if (s.length <= n) return s
  return s.slice(0, n).trimEnd() + '…'
}

function buildPayload({ payload, messages, repo, branch, remote, commits, filesTouched, signals, duration, projectInfo }) {
  const firstPrompt = extractFirstUserMessage(messages) || '(no user prompt)'
  const lastAssistant = extractLastAssistantText(messages) || ''

  // Subject line — use first ~60 chars of first prompt, single-line.
  const subject = truncate(firstPrompt.replace(/\s+/g, ' '), 60)
  const title = repo ? `${repo}: ${subject}` : subject

  // Body sections
  const sections = []
  sections.push('## Session')
  sections.push(`- Repo: ${repo || '(no git repo)'}`)
  if (branch) sections.push(`- Branch: ${branch}`)
  if (remote) sections.push(`- Remote: ${remote}`)
  sections.push(`- User turns: ${signals.userTurns}`)
  sections.push(`- Tool uses: ${signals.toolUses}`)
  sections.push(`- Files touched: ${filesTouched.length}`)
  if (duration > 0) sections.push(`- Duration: ${duration} min`)
  if (payload.reason) sections.push(`- End reason: ${payload.reason}`)

  sections.push('')
  sections.push('## First user prompt')
  sections.push('')
  sections.push('> ' + truncate(firstPrompt, 1500).replace(/\n/g, '\n> '))

  if (filesTouched.length > 0) {
    sections.push('')
    sections.push('## Files touched')
    sections.push('')
    for (const f of filesTouched.slice(0, 50)) sections.push(`- \`${f}\``)
    if (filesTouched.length > 50) sections.push(`- … and ${filesTouched.length - 50} more`)
  }

  if (commits.length > 0) {
    sections.push('')
    sections.push('## Commits during session')
    sections.push('')
    for (const c of commits) sections.push(`- ${c}`)
  }

  if (lastAssistant) {
    sections.push('')
    sections.push('## Final assistant message (excerpt)')
    sections.push('')
    sections.push(truncate(lastAssistant, 2000))
  }

  const bodyMd = sections.join('\n')
  const summary = truncate(firstPrompt.replace(/\s+/g, ' '), 240)

  return {
    title: truncate(title, 240),
    bodyMd,
    summary,
    type: 'session_summary',
    source: 'claude',
    realmId: projectInfo?.realmId ?? DEFAULT_REALM_ID,
    projectId: projectInfo?.id ?? null,
    taskId: null,
    sourceMetadata: {
      repo: repo || null,
      branch: branch || null,
      remote: remote || null,
      sessionId: payload.session_id || null,
      cwd: payload.cwd || null,
      hookEvent: payload.hook_event_name || null,
      endReason: payload.reason || null,
      projectName: projectInfo?.name ?? null,
      realmName: projectInfo?.realmName ?? null,
      filesTouched,
      commits,
      stats: {
        userTurns: signals.userTurns,
        toolUses: signals.toolUses,
        durationMin: duration,
        messageCount: messages.length,
      },
    },
    tags: [
      'session',
      ...(repo ? [repo] : []),
      ...(branch && branch !== 'main' && branch !== 'master' ? [`branch:${branch}`] : []),
    ],
  }
}

// ─── HTTP POST ──────────────────────────────────────────────────────────

async function postMemory(payload) {
  const url = `${BASE_URL}/api/v1/memories`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      warn(`POST failed ${res.status}: ${text.slice(0, 500)}`)
      return null
    }
    try {
      const parsed = JSON.parse(text)
      return parsed?.data?.id ?? null
    } catch {
      return null
    }
  } catch (err) {
    warn(`POST error: ${err.message}`)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// ─── shared session processor ───────────────────────────────────────────

// Process a single session transcript end-to-end: parse, quality-gate,
// build payload, post. Returns memory id on success, null on skip/fail.
async function processSession({ transcriptPath, sessionId, cwd, hookEvent, reason }) {
  const messages = parseTranscript(transcriptPath)
  if (!messages || messages.length === 0) {
    log(`skip ${basename(transcriptPath)}: no transcript or empty`)
    return null
  }

  const signals = countSignals(messages)
  if (signals.userTurns < MIN_USER_TURNS && signals.toolUses < MIN_TOOL_USES) {
    log(`skip ${basename(transcriptPath)}: below quality gate (userTurns=${signals.userTurns}, toolUses=${signals.toolUses})`)
    return null
  }

  // Resolve cwd from the transcript itself if not provided (backfill path).
  // Most Claude Code messages carry a `cwd` field — use the earliest one.
  const resolvedCwd =
    cwd ||
    messages.find((m) => typeof m.cwd === 'string' && m.cwd.length > 0)?.cwd ||
    process.cwd()

  const branch = gitCmd(resolvedCwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const remote = gitCmd(resolvedCwd, ['remote', 'get-url', 'origin'])
  // Repo slug strategy: prefer the dev_26 folder name (stable across forks /
  // remotes), fall back to git-remote basename, then cwd basename.
  const repoSlug =
    repoSlugFromCwd(resolvedCwd) ||
    (remote ? basename(remote).replace(/\.git$/, '') : null) ||
    (branch ? basename(resolvedCwd) : null)
  const repo = repoSlug

  // Resolve the matching Aeon project (and its realm) for this repo.
  const projectName = repoToProjectName(repoSlug)
  const projectInfo = projectName ? await resolveProject(projectName) : null

  const since = (() => {
    const first = messages[0]?.timestamp
    return first ? `--since=${first}` : '--since=24.hours.ago'
  })()
  const commitsRaw = gitCmd(resolvedCwd, ['log', '--pretty=%h %s', since, '-n', '20'])
  const commits = commitsRaw ? commitsRaw.split('\n').filter(Boolean) : []

  const filesTouched = extractFilesTouched(messages)
  const duration = sessionDurationMin(messages)

  const memoryPayload = buildPayload({
    payload: {
      session_id: sessionId,
      cwd: resolvedCwd,
      hook_event_name: hookEvent,
      reason,
    },
    messages,
    repo,
    branch,
    remote,
    commits,
    filesTouched,
    signals,
    duration,
    projectInfo,
  })

  if (DRY_RUN) {
    console.error(`[brain-capture] DRY RUN ${basename(transcriptPath)} — payload follows:`)
    console.error(JSON.stringify(memoryPayload, null, 2))
    return null
  }

  return postMemory(memoryPayload)
}

// ─── backfill mode ──────────────────────────────────────────────────────

const BACKFILL_LOCK = join(tmpdir(), 'aeon-brain-backfill.lock')
const BACKFILL_LOCK_TTL_MS = 60_000
const BACKFILL_MIN_IDLE_MS = 5 * 60_000  // skip transcripts mtime within last 5 min (likely still active)

function acquireBackfillLock() {
  try {
    if (existsSync(BACKFILL_LOCK)) {
      const lockAge = Date.now() - statSync(BACKFILL_LOCK).mtimeMs
      if (lockAge < BACKFILL_LOCK_TTL_MS) return false
      // Stale lock — overwrite below.
    }
    writeFileSync(BACKFILL_LOCK, String(process.pid))
    return true
  } catch {
    return false
  }
}

function releaseBackfillLock() {
  try { unlinkSync(BACKFILL_LOCK) } catch { /* ignore */ }
}

// Find every *.jsonl under ~/.claude/projects/<projectDir>/ whose mtime
// falls inside [now - hoursWindow, now - 5min]. Claude Code stores each
// transcript as <sessionId>.jsonl directly under the project directory
// (the uuid-named subdirs hold subagent state, not main transcripts).
function findCandidateTranscripts(hoursWindow) {
  const projectsRoot = join(homedir(), '.claude', 'projects')
  if (!existsSync(projectsRoot)) return []
  const now = Date.now()
  const minMtime = now - hoursWindow * 3600 * 1000
  const maxMtime = now - BACKFILL_MIN_IDLE_MS
  const out = []
  for (const projectDir of readdirSync(projectsRoot)) {
    const dir = join(projectsRoot, projectDir)
    let entries
    try { entries = readdirSync(dir) } catch { continue }
    for (const file of entries) {
      if (!file.endsWith('.jsonl')) continue
      const fullPath = join(dir, file)
      let st
      try { st = statSync(fullPath) } catch { continue }
      if (!st.isFile()) continue
      if (st.mtimeMs < minMtime || st.mtimeMs > maxMtime) continue
      out.push({
        path: fullPath,
        sessionId: file.replace(/\.jsonl$/, ''),
        mtime: st.mtimeMs,
      })
    }
  }
  // Process newest-first so a hard-cap stops after the most recent work.
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

async function runBackfill(hoursWindow) {
  if (!API_KEY) bail('AEON_API_KEY not set')

  if (!acquireBackfillLock()) {
    log('backfill: another run holds the lock — skipping')
    return
  }

  try {
    const candidates = findCandidateTranscripts(hoursWindow)
    log(`backfill: ${candidates.length} candidate transcript(s) in last ${hoursWindow}h`)

    let created = 0
    let skipped = 0
    let failed = 0
    // Server-side dedupe by sessionId (createMemory is idempotent for
    // source=claude) means we just iterate and post. If a session is already
    // captured, the brain returns the existing row instead of inserting.
    const MAX = parseInt(process.env.BRAIN_BACKFILL_MAX ?? '50', 10)
    for (const c of candidates.slice(0, MAX)) {
      const id = await processSession({
        transcriptPath: c.path,
        sessionId: c.sessionId,
        cwd: null,
        hookEvent: 'SessionEndBackfill',
        reason: 'backfill',
      })
      if (id === null) skipped++
      else if (id) created++
      else failed++
    }
    log(`backfill: created/upserted=${created} skipped=${skipped} failed=${failed}`)
  } finally {
    releaseBackfillLock()
  }
}

// ─── main ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { backfill: false, hours: parseInt(process.env.BRAIN_BACKFILL_HOURS ?? '48', 10) }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--backfill') out.backfill = true
    else if (args[i] === '--hours' && args[i + 1]) { out.hours = parseInt(args[++i], 10) || out.hours }
  }
  return out
}

async function runFromHook() {
  if (!API_KEY) bail('AEON_API_KEY not set')
  const payload = readStdin()
  log('payload event:', payload.hook_event_name, 'reason:', payload.reason)
  const id = await processSession({
    transcriptPath: payload.transcript_path,
    sessionId: payload.session_id,
    cwd: payload.cwd,
    hookEvent: payload.hook_event_name,
    reason: payload.reason,
  })
  if (id) log(`memory created/upserted: ${id}`)
}

async function main() {
  const args = parseArgs()
  if (args.backfill) {
    await runBackfill(args.hours)
  } else {
    await runFromHook()
  }
}

main().catch((err) => {
  warn(`unhandled: ${err.message}`)
  // Always exit 0 — never block the user's session.
  process.exit(0)
})
